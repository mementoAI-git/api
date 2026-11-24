import {describe, expect, it, vi} from 'vitest';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';

vi.mock('../../src/utils/config', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/utils/config')>()),
  MAIL_PORT: '465',
  MAIL_USER: 'info@example.com',
  MAIL_FROM_ADDRESS: 'noreply@example.com',
}));

import mail, {transport} from '../../src/module/mail';
import otp from '../../src/services/otp';

describe('verification SMTP delivery', () => {
  it('starts TLS immediately on port 465', () => {
    expect(transport.options as SMTPTransport.Options).toMatchObject({
      port: 465,
      secure: true,
    });
  });

  it('logs in as MAIL_USER and sends as MAIL_FROM_ADDRESS', async () => {
    expect((transport.options as SMTPTransport.Options).auth).toMatchObject({
      user: 'info@example.com',
    });
    const sendMail = vi.spyOn(transport, 'sendMail').mockResolvedValue({
      accepted: ['recipient@example.com'],
      rejected: [],
    } as never);
    await expect(
      mail.send({
        to: 'recipient@example.com',
        from: 'someone-else@example.com',
        subject: 'Hi',
        text: 'Hi',
      }),
    ).resolves.toBe(true);
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: {name: 'Memento', address: 'noreply@example.com'},
      }),
    );
    sendMail.mockRestore();
  });

  it.each(['code', 'link'] as const)(
    'rejects failed %s delivery instead of claiming the email was sent',
    async delivery => {
      vi.spyOn(otp, 'create').mockResolvedValue('012345');
      vi.spyOn(mail, 'send').mockResolvedValue(false);
      await expect(
        mail.sendLink('recipient@example.com', 'Jane', 'verify', delivery),
      ).rejects.toMatchObject({statusCode: 503});
    },
  );
});
