import {describe, expect, it, vi} from 'vitest';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';

vi.mock('../../src/utils/config', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/utils/config')>()),
  MAIL_PORT: '465',
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
