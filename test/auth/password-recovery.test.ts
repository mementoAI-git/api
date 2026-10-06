import {describe, expect, it, vi, afterEach} from 'vitest';
import request from 'supertest';
import {createTestApp} from '../helpers/app';
import {PasswordRecoveryCodes} from '../../src/services/password-recovery';
import User from '../../src/module/database/model/user';
import mail from '../../src/module/mail';
import redis from '../../src/services/redis';
import otp from '../../src/services/otp';

afterEach(() => vi.restoreAllMocks());
describe('password recovery endpoints', () => {
  it('sends a private code through the web endpoint', async () => {
    vi.spyOn(PasswordRecoveryCodes.prototype, 'issue').mockResolvedValue(
      '012345',
    );
    vi.spyOn(User, 'findOne').mockResolvedValue({first_name: 'Jane'});
    const send = vi
      .spyOn(mail, 'sendRecoveryCode')
      .mockResolvedValue(undefined);
    const response = await request(createTestApp())
      .post('/auth/recovery/send-code')
      .send({email: 'Jane@Example.com'});
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      email: 'jane@example.com',
      resend_after: 60,
    });
    expect(send).toHaveBeenCalledWith('jane@example.com', 'Jane', '012345');
    expect(JSON.stringify(response.body)).not.toContain('012345');
  });
  it('exchanges a code for a reset token', async () => {
    const verify = vi
      .spyOn(PasswordRecoveryCodes.prototype, 'verify')
      .mockResolvedValue('reset-token');
    const response = await request(createTestApp())
      .post('/auth/recovery/verify-code')
      .send({email: 'Jane@Example.com', code: '012345'});
    expect(response.status).toBe(200);
    expect(response.body.data.token).toBe('reset-token');
    expect(verify).toHaveBeenCalledWith('jane@example.com', '012345');
  });
  it('rejects malformed and expired codes', async () => {
    const verify = vi
      .spyOn(PasswordRecoveryCodes.prototype, 'verify')
      .mockResolvedValue(null);
    expect(
      (
        await request(createTestApp())
          .post('/auth/recovery/verify-code')
          .send({email: 'jane@example.com', code: 'abc'})
      ).status,
    ).toBe(422);
    expect(verify).not.toHaveBeenCalled();
    expect(
      (
        await request(createTestApp())
          .post('/auth/recovery/verify-code')
          .send({email: 'jane@example.com', code: '123456'})
      ).status,
    ).toBe(400);
  });
  it('does not send mail or reveal unknown accounts', async () => {
    vi.spyOn(PasswordRecoveryCodes.prototype, 'issue').mockResolvedValue(
      '012345',
    );
    vi.spyOn(User, 'findOne').mockResolvedValue(null);
    const send = vi
      .spyOn(mail, 'sendRecoveryCode')
      .mockResolvedValue(undefined);
    const response = await request(createTestApp())
      .post('/auth/recovery/send-code')
      .send({email: 'unknown@example.com'});
    expect(response.status).toBe(200);
    expect(send).not.toHaveBeenCalled();
  });
  it('atomically consumes reset tokens and rejects replay', async () => {
    const getDel = vi
      .spyOn(redis, 'getDel')
      .mockResolvedValueOnce(
        JSON.stringify({email: 'jane@example.com', used: false}),
      )
      .mockResolvedValue(null);
    expect(await otp.consume('token', 'reset')).toEqual({
      valid: true,
      email: 'jane@example.com',
    });
    expect(await otp.consume('token', 'reset')).toEqual({valid: false});
    expect(getDel).toHaveBeenCalledWith('otp:reset:token');
  });
});
