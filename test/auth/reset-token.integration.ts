import assert from 'node:assert/strict';
import {after, before, beforeEach, test} from 'node:test';

// Separate DB from the code tests. Never connect to application Redis.
process.env.REDIS_URL = 'redis://127.0.0.1:16389/1';
const redis = require('../../src/services/redis')
  .default as typeof import('../../src/services/redis').default;
const otp = require('../../src/services/otp')
  .default as typeof import('../../src/services/otp').default;
before(async () => {
  await redis.connect();
});
beforeEach(async () => {
  await redis.flushDb();
});
after(async () => {
  await redis.quit();
});

void test('legacy reset links are consumed once under concurrent submissions', async () => {
  const token = await otp.create('jane@example.com', 'reset');
  const results = await Promise.all(
    Array.from({length: 5}, () => otp.consume(token, 'reset')),
  );
  assert.equal(results.filter(result => result.valid).length, 1);
  assert.equal(results.find(result => result.valid)?.email, 'jane@example.com');
});

void test('used and expired reset tokens are rejected', async () => {
  const token = await otp.create('jane@example.com', 'reset');
  await otp.markUsed(token, 'reset');
  assert.equal((await otp.consume(token, 'reset')).valid, false);
  assert.equal((await otp.consume('unknown', 'reset')).valid, false);
});

void test('recovery service sends codes privately, verifies, and resets the password', async t => {
  const service = await import('../../src/module/api/auth/service');
  const User = (await import('../../src/module/database/model/user')).default;
  const mail = (await import('../../src/module/mail')).default;
  let deliveredCode = '';
  t.mock.method(User, 'findOne', async () => ({first_name: 'Jane'}));
  t.mock.method(
    mail,
    'sendRecoveryCode',
    async (email: string, name: string, code: string) => {
      assert.equal(email, 'jane@example.com');
      deliveredCode = code;
    },
  );
  const updates: unknown[] = [];
  t.mock.method(User, 'findOneAndUpdate', async (...args: unknown[]) => {
    updates.push(args);
    return {id: 'user-jane'};
  });
  const AuthSession = (
    await import('../../src/module/database/model/auth-session')
  ).default;
  const revoked = t.mock.method(AuthSession, 'updateMany', async () => ({
    modifiedCount: 1,
  }));
  const sent = await service.sendRecoveryCode({email: 'Jane@Example.com'});
  assert.match(deliveredCode, /^\d{6}$/);
  assert.deepEqual(sent.data, {email: 'jane@example.com', resend_after: 60});
  const verified = await service.verifyRecoveryCode({
    email: 'jane@example.com',
    code: deliveredCode,
  });
  const result = await service.setPassword({
    token: verified.data.token,
    password: 'NewPassword1!',
  });
  assert.equal(result.message, 'Password reset successful');
  assert.equal(revoked.mock.callCount(), 1);
  assert.deepEqual(revoked.mock.calls[0].arguments[0], {
    user_id: 'user-jane',
    revoked_at: null,
  });
  assert.equal(updates.length, 1);
  await assert.rejects(
    () =>
      service.setPassword({
        token: verified.data.token,
        password: 'OtherPassword1!',
      }),
    /Invalid or expired/,
  );
  assert.equal(updates.length, 1);
});

void test('unknown accounts receive the same recovery response without an email', async t => {
  const service = await import('../../src/module/api/auth/service');
  const User = (await import('../../src/module/database/model/user')).default;
  const mail = (await import('../../src/module/mail')).default;
  t.mock.method(User, 'findOne', async () => null);
  const send = t.mock.method(mail, 'sendRecoveryCode', async () => {});
  const result = await service.sendRecoveryCode({email: 'unknown@example.com'});
  assert.equal(
    result.message,
    'If an account exists for this email, a recovery code has been sent.',
  );
  assert.deepEqual(result.data, {
    email: 'unknown@example.com',
    resend_after: 60,
  });
  assert.equal(send.mock.callCount(), 0);
});
