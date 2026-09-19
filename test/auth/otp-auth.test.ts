import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
import request from 'supertest';
import {createTestApp} from '../helpers/app';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';
import {createUserFixture} from '../helpers/factories';
import otp from '../../src/services/otp';
import mail from '../../src/module/mail';
import redis from '../../src/services/redis';

describe('6-digit OTP authentication', () => {
  beforeAll(connectTestDatabase);
  afterEach(async () => {
    vi.restoreAllMocks();
    await clearTestDatabase();
  });
  afterAll(closeTestDatabase);

  it('generates 6-digit code for mobile client and sends otp email', async () => {
    const user = await createUserFixture({email: 'mobile-user@example.com'});
    let capturedDelivery: string | undefined;

    vi.spyOn(mail, 'sendLink').mockImplementation(
      async (email, name, type, delivery) => {
        capturedDelivery = delivery;
        return {code: '123456', expires_at: new Date().toISOString()};
      },
    );

    const response = await request(createTestApp())
      .post('/auth/send-link')
      .set('X-Memento-Client', 'ios')
      .send({
        email: user.email,
        type: 'verify',
      });

    expect(response.status).toBe(200);
    expect(response.body.data.delivery).toBe('code');
    expect(capturedDelivery).toBe('code');
  });

  it('generates and verifies 6-digit numeric OTP', async () => {
    vi.spyOn(redis, 'set').mockResolvedValue('OK' as any);
    vi.spyOn(redis, 'get').mockResolvedValue(
      JSON.stringify({
        email: 'otp-user@example.com',
        type: 'verify',
        used: false,
        createdAt: new Date().toISOString(),
      }) as any,
    );

    const code = await otp.create('otp-user@example.com', 'verify', {
      format: 'numeric',
      length: 6,
    });
    expect(code).toMatch(/^\d{6}$/);

    const verifyResult = await otp.verify(
      code,
      'verify',
      'otp-user@example.com',
    );
    expect(verifyResult.valid).toBe(true);
    expect(verifyResult.email).toBe('otp-user@example.com');

    // Mismatched email should fail
    const mismatch = await otp.verify(code, 'verify', 'other@example.com');
    expect(mismatch.valid).toBe(false);
  });
});
