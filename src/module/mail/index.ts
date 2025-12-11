import nodemailer from 'nodemailer';
import { MailOptions } from 'nodemailer/lib/sendmail-transport';
import {
  DEV_MAILS,
  FRONTEND_URL,
  BACKEND_URL,
  MAIL_HOST,
  MAIL_PASSWORD,
  MAIL_PORT,
  MAIL_USER,
  SUPPORT_MAILS,
} from '../../utils/config';
import dayjs from 'dayjs';
import * as ejs from 'ejs';
import * as path from 'path';
import { IBeneficiary } from '../database/model/beneficiary';
import { INotifyTeamFeedback } from './interface';
import otp, { OtpType } from '../../services/otp';

const transport = nodemailer.createTransport({
  //@ts-ignore
  host: MAIL_HOST,
  port: MAIL_PORT,
  secure: true,
  auth: {
    user: MAIL_USER,
    pass: MAIL_PASSWORD,
  },
});

class MailService {
  private templatePath = path.join(process.cwd(), 'views', 'mail');

  private async renderTemplate(
    templateName: string,
    data: any,
  ): Promise<string> {
    const templatePath = path.join(this.templatePath, `${templateName}.ejs`);
    const html = await ejs.renderFile(templatePath, { ...data });
    // return juice(html as string);
    return html as string;
  }

  async send(payload: MailOptions) {
    try {
      await transport.sendMail({
        from: MAIL_USER,
        to: DEV_MAILS,
        ...payload,
      });
    } catch (error) {
      console.log(error);
    }
  }

  async sendLink(email: string, name: string = '', type: 'reset' | 'verify' = 'reset') {
    const otpType: OtpType = type === 'verify' ? 'verify' : 'reset';

    // Create OTP using the centralized service
    const code = await otp.create(email, otpType);
    const ttlSeconds = otp.getTtl(otpType);
    const expires_at = dayjs().add(ttlSeconds, 'seconds').toISOString();

    const template = type === 'reset' ? 'reset-password' : 'email-verification';
    const subject =
      type === 'reset' ? 'Reset Password Link' : 'Email Verification Link';
    const urlPath = type === 'reset' ? 'set-password' : 'confirm-email';
    const url = `${FRONTEND_URL}/${urlPath}?token=${code}&email=${email}`;

    const html = await this.renderTemplate(template, { name, url, email });

    await this.send({ to: email, subject, html });

    return {
      code,
      expires_at,
    };
  }

  async sendBeneficiaryInvite(payload: IBeneficiary) {
    const { email, name, id } = payload;
    const html = await this.renderTemplate('beneficiary-invite', {
      name,
      email,
      url: `${FRONTEND_URL}/accept-invite/${id}`,
    });

    await this.send({
      to: email,
      subject: '[Memento] Beneficiary Invite',
      html,
    });
  }

  async sendInviteCode(payload: {
    email: string;
    code: string;
    invite_code: string;
  }) {
    const { email, code, invite_code } = payload;
    const html = await this.renderTemplate('invite-code', {
      email,
      code,
      name: '',
      imageUrl: `${BACKEND_URL}/assets/images/beneficiary-invite.png`,
      inviteLink: invite_code,
    });

    await this.send({
      to: email,
      subject: 'Beta invite: Memento',
      html,
    });
  }

  async sendWelcome(payload: { email: string; name: string }) {
    const { email, name } = payload;
    const html = await this.renderTemplate('welcome', {
      name,
      email,
      imageUrl: `${BACKEND_URL}/assets/images/welcome.png`,
    });

    await this.send({
      to: email,
      subject: 'You’re in. Welcome to Memento',
      html,
    });
  }

  async sendDeleteAccount(payload: { email: string; name: string }) {
    const { email, name } = payload;
    const html = await this.renderTemplate('delete-account', {
      name,
      email,
      imageUrl: `${BACKEND_URL}/assets/images/delete-account.png`,
    });

    await this.send({
      to: email,
      subject: 'Your Memento account has been deleted',
      html,
    });
  }

  // async sendDeleteAccount(payload: { email: string, name: string }) { }

  /**
   * Send feedback confirmation to the user
   */
  async sendFeedbackConfirmation(payload: {
    email: string;
    name: string;
    type: string;
    message: string;
  }) {
    const { email, name, type, message } = payload;
    const html = await this.renderTemplate('feedback-confirmation', {
      name,
      email,
      type,
      message: message.substring(0, 100), // Preview of their message
      imageUrl: `${BACKEND_URL}/assets/images/feedback-received.png`,
    });
    await this.send({
      to: email,
      subject: 'We received your feedback - Memento',
      html,
    });
  }

  /**
   * Notify team about new feedback
   */
  async notifyTeamFeedback(payload: INotifyTeamFeedback) {
    const { type, message, name = 'Anonymous', screenshot, feedbackId } = payload;

    const html = await this.renderTemplate('team-feedback-notification', {
      type,
      message,
      email: SUPPORT_MAILS,
      name,
      screenshotUrl: screenshot,
      feedbackId,
      feedbackUrl: `${BACKEND_URL}/admin/feedback/${feedbackId}`,
      submittedAt: dayjs().format('MMMM D, YYYY h:mm A'),
    });

    await this.send({
      to: SUPPORT_MAILS,
      subject: "We've got Feedback",
      html,
    });
  }
}

export default new MailService();
