import {readdirSync} from 'fs';
import * as path from 'path';
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
import mail, {formatDuration} from '../../src/module/mail';
import {
  completeOnboarding,
  deletePasskey,
  disable2FA,
  skipOnboarding,
} from '../../src/module/api/user/service';
import {acceptInvite} from '../../src/module/api/beneficiary/service';
import Beneficiary from '../../src/module/database/model/beneficiary';
import User from '../../src/module/database/model/user';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';
import {createUserFixture} from '../helpers/factories';

const TEMPLATE_DATA: Record<string, Record<string, unknown>> = {
  'email-verification': {url: 'https://app/x', expiresIn: '10 minutes'},
  'email-verification-otp': {code: '123456', expiresIn: '10 minutes'},
  'reset-password': {url: 'https://app/x', expiresIn: '10 minutes'},
  'reset-password-otp': {code: '123456', expiresIn: '10 minutes'},
  'password-recovery-code': {code: '123456', expiresIn: '10 minutes'},
  welcome: {},
  'invite-code': {inviteLink: 'https://app/register'},
  'beneficiary-invite': {
    inviterName: 'Ada',
    isConnection: false,
    url: 'https://app/a',
  },
  'invite-accepted': {
    inviteeName: 'Grace',
    isConnection: true,
    peopleUrl: 'https://app/p',
  },
  'timecapsule-reveal': {benefactorName: 'Ada', url: 'https://app/c'},
  'archive-export': {url: 'https://app/z', expiresAt: 'Today'},
  'archive-export-failed': {},
  'account-deactivated': {scheduledFor: 'Tomorrow'},
  'delete-account': {},
  'feedback-confirmation': {type: 'bug report', message: 'Hi'},
  'team-feedback-notification': {
    type: 'Bug',
    label: 'bug report',
    message: 'Hi',
    userEmail: 'a@example.com',
    feedbackId: 'f1',
    submittedAt: 'Now',
    screenshotUrl: '',
  },
  'security-alert': {
    heading: 'Your password was',
    emphasis: 'changed',
    summary: 'Changed.',
    details: [['Account', 'a@example.com']],
    resetUrl: 'https://app/f',
  },
};

describe('email templates', () => {
  const templates = readdirSync(path.join(process.cwd(), 'views', 'mail'))
    .filter(file => file.endsWith('.ejs'))
    .map(file => file.replace(/\.ejs$/, ''));

  it('has sample data for every template', () => {
    expect(templates.sort()).toEqual(Object.keys(TEMPLATE_DATA).sort());
  });

  it.each(Object.entries(TEMPLATE_DATA))(
    'renders %s in the current brand with inlined styles',
    async (template, data) => {
      const html = await mail.renderTemplate(template, {
        name: 'Ada',
        email: 'ada@example.com',
        ...data,
      });
      expect(html).toContain('/assets/images/memento-icon.png');
      expect(html).toContain('support@mymemento.io');
      expect(html).toMatch(
        /<td class="card"[^>]*style="[^"]*background-color: #FFFFFF/,
      );
      expect(html).toContain('Memento.</span>');
      // Old brand, illustrations and the fake unsubscribe line are gone.
      expect(html).not.toMatch(/#52A1DD|#1570EF|Inter,|class="logo"/);
      expect(html).not.toMatch(/unsubscribe/i);
      // Memento is "your Memento", never an "AI twin" or "digital twin".
      expect(html).not.toMatch(/\btwin\b|beneficiar/i);
      // Every text link uses the brand orange.
      for (const link of html.match(/<a [^>]*>/g) ?? []) {
        if (!link.includes('btn') && !/text-decoration: none/.test(link)) {
          expect(link).toContain('color: #E98246');
        }
      }
      expect(html).not.toMatch(
        /assets\/images\/(welcome|delete-account|beneficiary-invite|feedback-received)\.png/,
      );
    },
  );
});

describe('welcome and signup content', () => {
  it('keeps the welcome short: four one-line features, then the button', async () => {
    const html = await mail.renderTemplate('welcome', {name: 'Ada'});
    expect(html.match(/<li /g)).toHaveLength(4);
    expect(html.indexOf('Open Memento')).toBeGreaterThan(
      html.lastIndexOf('</ul>'),
    );
    expect(html).toContain('With gratitude,');
    expect(html).not.toMatch(/PRIVATE BY DESIGN|beta/i);
    expect(html).toContain('Talk to your Memento.');
  });

  it('tells new members what is waiting after verification', async () => {
    const html = await mail.renderTemplate('email-verification-otp', {
      code: '123456',
      expiresIn: '10 minutes',
    });
    expect(html).toContain('write or record your first story');
  });

  it('invites without a code now that signup is open', async () => {
    const send = vi.spyOn(mail, 'send').mockResolvedValue(true);
    await mail.sendInviteCode({
      email: 'g@example.com',
      name: 'Grace',
      code: '305118',
      invite_code: 'https://app/register?code=305118',
    });
    const {subject, html} = send.mock.calls[0][0] as {
      subject: string;
      html: string;
    };
    expect(subject).toBe('You’re invited to Memento');
    expect(html).not.toMatch(/305118|invite code|beta/i);
    expect(html).toContain('/register"');
  });

  it('says people and connection, never beneficiary', async () => {
    const send = vi.spyOn(mail, 'send').mockResolvedValue(true);
    for (const access_scope of ['full_vault', 'shared_only']) {
      await mail.sendBeneficiaryInvite({
        id: 'i',
        email: 'g@example.com',
        name: 'Grace',
        access_scope,
      } as never);
    }
    for (const isConnection of [false, true]) {
      await mail.sendInviteAccepted({
        email: 'a@example.com',
        name: 'Ada',
        inviteeName: 'Grace',
        isConnection,
      });
    }
    for (const [message] of send.mock.calls) {
      const {subject, html} = message as {subject: string; html: string};
      expect(`${subject} ${html}`).not.toMatch(/beneficiar/i);
    }
  });

  it('sends the forgot-password flow a code, never a link', async () => {
    const send = vi.spyOn(mail, 'send').mockResolvedValue(true);
    await mail.sendRecoveryCode('ada@example.com', 'Ada', '660421');
    const {html} = send.mock.calls[0][0] as {html: string};
    expect(html).toContain('660421');
    expect(html).toContain('expires in 10 minutes');
    expect(html).not.toMatch(/class="btn-cell"|copy this link|set-password/);
  });

  it('uses the social links from mymemento.io and no postal address', async () => {
    const html = await mail.renderTemplate('welcome', {name: 'Ada'});
    expect(html).toContain('https://x.com/MementoAI');
    expect(html).toContain('https://www.linkedin.com/company/memento-ai/');
    expect(html).toContain('/assets/images/email-backdrop.png');
    expect(html).not.toMatch(/World Trade Center|Greenwich/);
  });
});

describe('formatDuration', () => {
  it('describes OTP lifetimes in words', () => {
    expect(formatDuration(600)).toBe('10 minutes');
    expect(formatDuration(3600)).toBe('1 hour');
    expect(formatDuration(5 * 24 * 60 * 60)).toBe('5 days');
    expect(formatDuration(90)).toBe('2 minutes');
  });
});

describe('notification emails', () => {
  beforeAll(connectTestDatabase);
  afterEach(async () => {
    vi.restoreAllMocks();
    await clearTestDatabase();
  });
  afterAll(closeTestDatabase);

  const flush = () => new Promise(resolve => setTimeout(resolve, 20));

  it('sends a security alert with the event copy as the subject', async () => {
    const send = vi.spyOn(mail, 'send').mockResolvedValue(true);
    await mail.sendSecurityAlert({
      email: 'ada@example.com',
      name: 'Ada',
      event: 'passkey_added',
      device: 'iPhone',
    });
    expect(send.mock.calls[0][0]).toMatchObject({
      to: 'ada@example.com',
      subject: 'A passkey was added to your Memento account',
    });
    expect(send.mock.calls[0][0].html).toContain('iPhone');
  });

  it('alerts when two-step verification is turned off, but only if it was on', async () => {
    const alert = vi.spyOn(mail, 'sendSecurityAlert').mockResolvedValue();
    const off = await createUserFixture();
    await disable2FA(off.id);
    await flush();
    expect(alert).not.toHaveBeenCalled();

    const on = await createUserFixture({
      two_factor: {enabled: true, secret: 'SECRET'},
    } as never);
    await disable2FA(on.id);
    await flush();
    expect(alert).toHaveBeenCalledWith(
      expect.objectContaining({email: on.email, event: 'two_factor_disabled'}),
    );
  });

  it('names the removed passkey', async () => {
    const alert = vi.spyOn(mail, 'sendSecurityAlert').mockResolvedValue();
    const user = await createUserFixture({
      passkeys: [
        {
          credential_id: 'cred-1',
          public_key: 'key',
          counter: 0,
          device_name: 'Work laptop',
          created_at: new Date(),
        },
      ],
    } as never);
    await deletePasskey(user.id, 'cred-1');
    await flush();
    expect(alert).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'passkey_removed',
        device: 'Work laptop',
      }),
    );
  });

  it('does not let a failed alert break the action', async () => {
    vi.spyOn(mail, 'sendSecurityAlert').mockRejectedValue(new Error('smtp'));
    const user = await createUserFixture({
      two_factor: {enabled: true, secret: 'SECRET'},
    } as never);
    await expect(disable2FA(user.id)).resolves.toMatchObject({
      message: '2FA disabled successfully',
    });
    await flush();
  });

  it('tells the inviter when their invite is accepted', async () => {
    const accepted = vi.spyOn(mail, 'sendInviteAccepted').mockResolvedValue();
    const inviter = await createUserFixture({first_name: 'Ada'});
    const invitee = await createUserFixture();
    const invite = await Beneficiary.create({
      benefactor: inviter.id,
      user: invitee.id,
      name: 'Grace',
      email: invitee.email,
      status: 'pending',
      access_scope: 'full_vault',
    });
    await User.updateOne(
      {_id: invitee.id},
      {$set: {first_name: 'Grace', last_name: 'Hopper'}},
    );
    await acceptInvite({
      invite_id: invite.id,
      first_name: 'Grace',
      last_name: 'Hopper',
      dob: '1990-01-01',
    });
    await flush();
    expect(accepted).toHaveBeenCalledWith({
      email: inviter.email,
      name: 'Ada',
      inviteeName: 'Grace Hopper',
      isConnection: false,
    });
  });

  it('sends one welcome whether onboarding is skipped, then finished', async () => {
    const welcome = vi.spyOn(mail, 'sendWelcome').mockResolvedValue();
    const user = await createUserFixture({nickname: 'Ada'});
    await skipOnboarding(user.id);
    await flush();
    await completeOnboarding(user.id);
    await flush();
    expect(welcome).toHaveBeenCalledTimes(1);
    expect(welcome).toHaveBeenCalledWith({email: user.email, name: 'Ada'});
  });

  it('does not re-welcome an account that had already finished onboarding', async () => {
    const welcome = vi.spyOn(mail, 'sendWelcome').mockResolvedValue();
    const user = await createUserFixture({
      onboarding_status: 'completed',
    } as never);
    await completeOnboarding(user.id);
    await flush();
    expect(welcome).not.toHaveBeenCalled();
  });
});
