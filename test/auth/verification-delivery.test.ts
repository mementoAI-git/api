import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
import request from 'supertest';
import {createTestApp} from '../helpers/app';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';
import {createUserFixture} from '../helpers/factories';
import mail, {transport} from '../../src/module/mail';
import otp from '../../src/services/otp';
import {hashPassword} from '../../src/utils/helpers';

describe('web email verification delivery', () => {
  beforeAll(connectTestDatabase);
  afterEach(async () => {
    vi.restoreAllMocks();
    await clearTestDatabase();
  });
  afterAll(closeTestDatabase);
  it('sends a code when an unverified web user signs in', async () => {
    const password = 'Password1!';
    const user = await createUserFixture({
      verified: false,
      password: await hashPassword(password),
    });
    const send = vi.spyOn(mail, 'sendLink').mockResolvedValue({
      code: '123456',
      expires_at: new Date().toISOString(),
    });
    const response = await request(createTestApp())
      .post('/auth/login')
      .set('X-Memento-Client', 'web')
      .send({email: user.email, password});
    expect(response.body.data.requires_verification).toBe(true);
    expect(send).toHaveBeenCalledWith(
      user.email,
      user.first_name,
      'verify',
      'code',
    );
  });
  it('defaults web signup to a code email even without a delivery flag', async () => {
    vi.spyOn(otp, 'create').mockResolvedValue('012345');
    const send = vi
      .spyOn(transport, 'sendMail')
      .mockImplementation(
        async () => ({messageId: 'test', accepted: [], rejected: []}) as never,
      );
    const response = await request(createTestApp())
      .post('/auth/register')
      .set('X-Memento-Client', 'web')
      .send({
        email: 'new-code-user@example.com',
        password: 'Password1!',
        first_name: 'Jane',
        last_name: 'Test',
      });
    expect(response.status).toBe(200);
    expect(otp.create).toHaveBeenCalledWith(
      'new-code-user@example.com',
      'verify',
      {format: 'numeric', length: 6},
    );
    const message = send.mock.calls[0][0] as {subject: string; html: string};
    expect(message.subject).toBe('Your Memento Verification Code');
    expect(message.html).toContain('012345');
    expect(message.html).not.toContain('/confirm-email?token=');
  });
  it.each([undefined, 'link'] as const)(
    'resend defaults to a code but honors explicit links (%s)',
    async delivery => {
      const user = await createUserFixture({verified: false});
      const send = vi.spyOn(mail, 'sendLink').mockResolvedValue({
        code: '123456',
        expires_at: new Date().toISOString(),
      });
      const response = await request(createTestApp())
        .post('/auth/send-link')
        .set('X-Memento-Client', 'web')
        .send({
          email: user.email,
          type: 'verify',
          ...(delivery ? {delivery} : {}),
        });
      expect(response.status).toBe(200);
      expect(send).toHaveBeenCalledWith(
        user.email,
        user.first_name,
        'verify',
        delivery || 'code',
      );
    },
  );
});
