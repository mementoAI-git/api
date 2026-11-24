import nodemailer from 'nodemailer';
import addressparser from 'nodemailer/lib/addressparser';
import {MailOptions} from 'nodemailer/lib/sendmail-transport';
import {
  DEV_MAILS,
  FRONTEND_URL,
  BACKEND_URL,
  MAIL_FROM_ADDRESS,
  MAIL_FROM_NAME,
  MAIL_HOST,
  MAIL_PASSWORD,
  MAIL_PORT,
  MAIL_USER,
  SUPPORT_MAILS,
} from '../../utils/config';
import dayjs from 'dayjs';
import * as ejs from 'ejs';
import * as path from 'path';
import juice from 'juice';
import {IBeneficiary} from '../database/model/beneficiary';
import User from '../database/model/user';
import {INotifyTeamFeedback, SecurityEvent} from './interface';
import otp, {OtpType} from '../../services/otp';
import {RECOVERY_CODE_TTL_SECONDS} from '../../services/password-recovery';
import logger from '../../utils/logger';
import {ServiceUnavailableException} from '../../utils/service-error';

// const transport = nodemailer.createTransport({
//   //@ts-ignore
//   host: MAIL_HOST,
//   port: MAIL_PORT,
//   secure: true,
//   auth: {
//     user: MAIL_USER,
//     pass: MAIL_PASSWORD,
//   },
// });

const smtpPort = Number(MAIL_PORT);
export const transport = nodemailer.createTransport({
  host: MAIL_HOST,
  port: smtpPort,
  secure: smtpPort === 465,
  requireTLS: smtpPort !== 465,
  auth: {user: MAIL_USER, pass: MAIL_PASSWORD},
  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  socketTimeout: 15_000,
});

const SUPPORT_EMAIL = 'support@mymemento.io';
const TERMS_URL = 'https://www.mymemento.io/legal-pages/terms-of-service/';
const PRIVACY_URL = 'https://www.mymemento.io/legal-pages/privacy/';
// Mirrors the links on mymemento.io.
const SOCIAL_LINKS = {
  x: 'https://x.com/MementoAI',
  linkedin: 'https://www.linkedin.com/company/memento-ai/',
  facebook: 'https://facebook.com/people/Memento-AI/61567679645641/',
};

/** Turns an OTP lifetime into copy such as "10 minutes" or "5 days". */
export function formatDuration(seconds: number): string {
  const units: [number, string][] = [
    [24 * 60 * 60, 'day'],
    [60 * 60, 'hour'],
    [60, 'minute'],
  ];
  for (const [size, unit] of units) {
    if (seconds >= size && seconds % size === 0) {
      const count = seconds / size;
      return `${count} ${unit}${count === 1 ? '' : 's'}`;
    }
  }
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

function formatEventTime(date: Date): string {
  return `${date.toLocaleString('en-US', {
    timeZone: 'UTC',
    dateStyle: 'long',
    timeStyle: 'short',
  })} UTC`;
}

const FEEDBACK_LABELS: Record<string, string> = {
  Bug: 'bug report',
  'Feature Request': 'feature request',
  'UI/UX Issue': 'UI/UX issue',
};

/** "Bug" reads as "bug report"; general or unknown types read as "feedback". */
function feedbackLabel(type: string): string {
  return FEEDBACK_LABELS[type] ?? 'feedback';
}

const SECURITY_COPY: Record<
  SecurityEvent,
  {subject: string; heading: string; emphasis: string; summary: string}
> = {
  password_changed: {
    subject: 'Your Memento password was changed',
    heading: 'Your password was',
    emphasis: 'changed',
    summary: 'The password for your Memento account was just changed.',
  },
  password_reset: {
    subject: 'Your Memento password was reset',
    heading: 'Your password was',
    emphasis: 'reset',
    summary:
      'Your Memento password was reset using a link or code sent to this address. You have been signed out on every device.',
  },
  two_factor_enabled: {
    subject: 'Two-step verification is on',
    heading: 'Two-step verification is',
    emphasis: 'on',
    summary:
      'Two-step verification was turned on for your Memento account. Signing in now needs a code from your authenticator app as well as your password.',
  },
  two_factor_disabled: {
    subject: 'Two-step verification is off',
    heading: 'Two-step verification is',
    emphasis: 'off',
    summary:
      'Two-step verification was turned off for your Memento account. Signing in now only needs your password.',
  },
  passkey_added: {
    subject: 'A passkey was added to your Memento account',
    heading: 'A passkey was',
    emphasis: 'added',
    summary:
      'A new passkey was added to your Memento account. It can be used to sign in without a password.',
  },
  passkey_removed: {
    subject: 'A passkey was removed from your Memento account',
    heading: 'A passkey was',
    emphasis: 'removed',
    summary:
      'A passkey was removed from your Memento account. It can no longer be used to sign in.',
  },
};

class MailService {
  private getTemplatePath(): string {
    const buildPath = path.join(__dirname, '..', '..', '..', 'views', 'mail');
    if (require('fs').existsSync(buildPath)) {
      return buildPath;
    }
    return path.join(process.cwd(), 'views', 'mail');
  }

  private templatePath = this.getTemplatePath();

  /**
   * Renders a template inside the shared layout and inlines its CSS, since
   * Gmail and Outlook drop or ignore most of a <style> block.
   */
  async renderTemplate(
    templateName: string,
    data: Record<string, unknown>,
  ): Promise<string> {
    const templatePath = path.join(this.templatePath, `${templateName}.ejs`);
    const html = await ejs.renderFile(templatePath, {
      name: '',
      email: '',
      preheader: '',
      appUrl: FRONTEND_URL,
      logoUrl: `${BACKEND_URL}/assets/images/memento-icon.png`,
      backdropUrl: `${BACKEND_URL}/assets/images/email-backdrop.png`,
      socialLinks: SOCIAL_LINKS,
      supportEmail: SUPPORT_EMAIL,
      termsUrl: TERMS_URL,
      privacyUrl: PRIVACY_URL,
      ...data,
    });
    return juice(html, {
      preserveMediaQueries: true,
      preserveImportant: true,
      removeStyleTags: true,
    });
  }

  // async send(payload: MailOptions) {
  //   try {
  //     const recipients = [payload.to, DEV_MAILS]
  //     .filter(Boolean)
  //     .join(', ');

  //     await transport.sendMail({
  //       from: MAIL_USER,
  //       to: recipients,
  //     });
  //   } catch (error) {
  //     logger.error(error, 'Error sending email');
  //   }
  // }

  async send(payload: MailOptions): Promise<boolean> {
    const start = Date.now();
    try {
      const recipients = [payload.to].filter(Boolean).join(', ');
      logger.info(
        {to: recipients, host: MAIL_HOST, port: MAIL_PORT},
        'mail.send: attempting SMTP send',
      );
      const info = await transport.sendMail({
        ...payload,
        // Always last so every email shows "Memento" as the sender.
        from: {name: MAIL_FROM_NAME, address: MAIL_FROM_ADDRESS ?? ''},
        to: recipients,
      });
      logger.info(
        {
          ms: Date.now() - start,
          messageId: info.messageId,
          accepted: info.accepted,
          rejected: info.rejected,
        },
        'mail.send: SMTP send completed',
      );
      const expected = addressparser(recipients, {flatten: true}).map(
        recipient => recipient.address.trim().toLowerCase(),
      );
      const normalize = (value: string | {address: string}) =>
        (typeof value === 'string' ? value : value.address)
          .trim()
          .toLowerCase();
      const accepted = new Set((info.accepted || []).map(normalize));
      const rejected = new Set((info.rejected || []).map(normalize));
      return (
        expected.length > 0 &&
        expected.every(
          recipient => accepted.has(recipient) && !rejected.has(recipient),
        )
      );
    } catch (error) {
      logger.error(
        {error, ms: Date.now() - start},
        'mail.send: SMTP send failed',
      );
      return false;
    }
  }

  async sendRecoveryCode(email: string, name: string, code: string) {
    const html = await this.renderTemplate('password-recovery-code', {
      name,
      email,
      code,
      expiresIn: formatDuration(RECOVERY_CODE_TTL_SECONDS),
      preheader: `Your code is ${code}`,
    });
    await this.send({
      to: email,
      subject: 'Your Memento password reset code',
      html,
    });
  }

  async sendLink(
    email: string,
    name = '',
    type: 'reset' | 'verify' = 'reset',
    delivery: 'link' | 'code' = 'link',
  ) {
    const otpType: OtpType = type === 'verify' ? 'verify' : 'reset';
    const isCode = delivery === 'code';

    // Create OTP using the centralized service (numeric for code delivery)
    const code = await otp.create(
      email,
      otpType,
      isCode ? {format: 'numeric', length: 6} : undefined,
    );
    const ttlSeconds = otp.getTtl(otpType);
    const expires_at = dayjs().add(ttlSeconds, 'seconds').toISOString();
    const expiresIn = formatDuration(ttlSeconds);

    if (isCode) {
      const template =
        type === 'reset' ? 'reset-password-otp' : 'email-verification-otp';
      const subject =
        type === 'reset'
          ? 'Your Memento password reset code'
          : 'Your Memento verification code';

      const html = await this.renderTemplate(template, {
        name,
        code,
        email,
        expiresIn,
        preheader: `Your code is ${code}`,
      });
      if (!(await this.send({to: email, subject, html}))) {
        throw new ServiceUnavailableException(
          'Unable to send email. Please try again shortly.',
        );
      }

      return {
        code,
        expires_at,
      };
    }

    // Link emails only reach clients that send no client header (old app
    // builds); web, iOS and Android default to codes.
    const template = type === 'reset' ? 'reset-password' : 'email-verification';
    const subject =
      type === 'reset'
        ? 'Reset your Memento password'
        : 'Confirm your email for Memento';
    const urlPath = type === 'reset' ? 'set-password' : 'confirm-email';
    const url = `${FRONTEND_URL}/${urlPath}?token=${encodeURIComponent(
      code,
    )}&email=${encodeURIComponent(email)}`;

    const html = await this.renderTemplate(template, {
      name,
      url,
      email,
      expiresIn,
      preheader:
        type === 'reset'
          ? 'Choose a new password for your Memento account.'
          : 'One quick step to finish setting up your account.',
    });

    if (!(await this.send({to: email, subject, html}))) {
      throw new ServiceUnavailableException(
        'Unable to send email. Please try again shortly.',
      );
    }

    return {
      code,
      expires_at,
    };
  }

  private async displayName(userId: string): Promise<string> {
    try {
      const user = await User.findById(userId)
        .select('first_name last_name nickname')
        .lean();
      const full = [user?.first_name, user?.last_name]
        .filter(Boolean)
        .join(' ')
        .trim();
      return full || user?.nickname || '';
    } catch {
      return '';
    }
  }

  async sendBeneficiaryInvite(payload: IBeneficiary) {
    const {email, name, id} = payload;
    const isConnection = payload.access_scope === 'shared_only';
    const inviterName =
      (await this.displayName(String(payload.benefactor))) || 'Someone';
    const html = await this.renderTemplate('beneficiary-invite', {
      name,
      email,
      inviterName,
      url: `${FRONTEND_URL}/accept-invite/${id}`,
      isConnection,
      preheader: isConnection
        ? `${inviterName} invited you to a private shared space on Memento.`
        : `${inviterName} added you to their people on Memento.`,
    });

    return this.send({
      to: email,
      subject: isConnection
        ? `${inviterName} invited you to connect on Memento`
        : `${inviterName} added you as a connection on Memento`,
      html,
    });
  }

  /** Tells the person who sent an invite that it was accepted. */
  async sendInviteAccepted(payload: {
    email: string;
    name: string;
    inviteeName: string;
    isConnection: boolean;
  }) {
    const {email, name, inviteeName, isConnection} = payload;
    const html = await this.renderTemplate('invite-accepted', {
      name,
      email,
      inviteeName,
      isConnection,
      peopleUrl: `${FRONTEND_URL}/people`,
      preheader: isConnection
        ? `You and ${inviteeName} are now connected on Memento.`
        : `${inviteeName} is now one of your people on Memento.`,
    });
    await this.send({
      to: email,
      subject: `${inviteeName} accepted your invite`,
      html,
    });
  }

  async sendCapsuleReveal(payload: {
    email: string;
    name: string;
    url: string;
    benefactorName: string;
  }) {
    const {email, name, url, benefactorName} = payload;
    const html = await this.renderTemplate('timecapsule-reveal', {
      name,
      email,
      url,
      benefactorName,
      preheader: `${benefactorName} left something for you to open today.`,
    });

    await this.send({
      to: email,
      subject: `A time capsule from ${benefactorName} has opened`,
      html,
    });
  }

  /**
   * Invites someone to sign up. Signup is open, so the invite carries no code;
   * the payload keeps `code` and `invite_code` for the existing endpoint.
   */
  async sendInviteCode(payload: {
    email: string;
    code: string;
    invite_code: string;
    name: string;
  }) {
    const {email, name} = payload;
    const html = await this.renderTemplate('invite-code', {
      email,
      name,
      inviteLink: `${FRONTEND_URL}/register`,
      preheader: 'A quiet, personal space to preserve your story.',
    });

    await this.send({
      to: email,
      subject: 'You’re invited to Memento',
      html,
    });
  }

  async sendWelcome(payload: {email: string; name: string}) {
    const {email, name} = payload;
    const html = await this.renderTemplate('welcome', {
      name,
      email,
      preheader: 'A private place for the stories that make you who you are.',
    });

    await this.send({
      to: email,
      subject: 'Welcome to Memento',
      html,
    });
  }

  async sendDeleteAccount(payload: {email: string; name: string}) {
    const {email, name} = payload;
    const html = await this.renderTemplate('delete-account', {
      name,
      email,
      preheader: 'Your account and its data have been permanently deleted.',
    });

    await this.send({
      to: email,
      subject: 'Your Memento account has been deleted',
      html,
    });
  }

  async sendAccountDeactivated(payload: {
    email: string;
    name: string;
    scheduled_for: Date;
  }) {
    const scheduledFor = dayjs(payload.scheduled_for).format('MMMM D, YYYY');
    const html = await this.renderTemplate('account-deactivated', {
      name: payload.name,
      email: payload.email,
      scheduledFor,
      appUrl: `${FRONTEND_URL}/login`,
      preheader: `Sign in before ${scheduledFor} to keep your account.`,
    });
    await this.send({
      to: payload.email,
      subject: 'Your Memento account is deactivated',
      html,
    });
  }

  async sendArchiveExport(payload: {
    email: string;
    name: string;
    url: string;
    expires_at: Date;
  }) {
    const expiresAt = dayjs(payload.expires_at).format(
      'MMMM D, YYYY [at] h:mm A',
    );
    const html = await this.renderTemplate('archive-export', {
      name: payload.name,
      email: payload.email,
      url: payload.url,
      expiresAt,
      preheader: `Download your stories and time capsules before ${expiresAt}.`,
    });
    await this.send({
      to: payload.email,
      subject: 'Your Memento archive is ready',
      html,
    });
  }

  async sendArchiveExportFailed(payload: {email: string; name: string}) {
    const html = await this.renderTemplate('archive-export-failed', {
      name: payload.name,
      email: payload.email,
      preheader: 'Write to us and we’ll prepare your archive for you.',
    });
    await this.send({
      to: payload.email,
      subject: 'We couldn’t prepare your Memento archive',
      html,
    });
  }

  /** Confirms a change to how the account signs in. */
  async sendSecurityAlert(payload: {
    email: string;
    name: string;
    event: SecurityEvent;
    device?: string;
    at?: Date;
  }) {
    const copy = SECURITY_COPY[payload.event];
    const details: [string, string][] = [
      ['Account', payload.email],
      ['When', formatEventTime(payload.at ?? new Date())],
    ];
    if (payload.device) details.push(['Passkey', payload.device]);
    const html = await this.renderTemplate('security-alert', {
      name: payload.name,
      email: payload.email,
      heading: copy.heading,
      emphasis: copy.emphasis,
      summary: copy.summary,
      details,
      resetUrl: `${FRONTEND_URL}/forget-password`,
      preheader: 'If this wasn’t you, reset your password now.',
    });
    await this.send({to: payload.email, subject: copy.subject, html});
  }

  /**
   * Send feedback confirmation to the user
   */
  async sendFeedbackConfirmation(payload: {
    email: string;
    name: string;
    type: string;
    message: string;
  }) {
    const {email, name, type, message} = payload;
    const preview =
      message.length > 140 ? `${message.slice(0, 140).trimEnd()}…` : message;
    const html = await this.renderTemplate('feedback-confirmation', {
      name,
      email,
      type: feedbackLabel(type),
      message: preview,
      preheader: 'Every message is read by a person on the team.',
    });
    await this.send({
      to: email,
      subject: 'We received your feedback',
      html,
    });
  }

  /**
   * Notify team about new feedback
   */
  async notifyTeamFeedback(payload: INotifyTeamFeedback) {
    const {type, message, name = 'Anonymous', screenshot, feedbackId} = payload;

    const label = feedbackLabel(type);
    const html = await this.renderTemplate('team-feedback-notification', {
      type,
      label,
      message,
      name,
      userEmail: payload.email,
      screenshotUrl: screenshot,
      feedbackId,
      submittedAt: formatEventTime(new Date()),
      preheader: message.slice(0, 120),
    });

    await this.send({
      to: SUPPORT_MAILS,
      subject: `New ${label} from ${name}`,
      replyTo: payload.email || undefined,
      html,
    });
  }
}

export default new MailService();

/**
 * Sends a notification without letting a mail failure (or a partially mocked
 * mail module in tests) affect the action that triggered it.
 */
export function notifyInBackground(
  label: string,
  sendMail: () => Promise<unknown>,
): void {
  void Promise.resolve()
    .then(sendMail)
    .catch(error =>
      logger.warn(
        {label, errorCode: error instanceof Error ? error.name : 'unknown'},
        'Notification email failed',
      ),
    );
}
