import assert from 'node:assert/strict';
import {test} from 'vitest';
import {validationResult} from 'express-validator';
import valid from '../../src/module/api/auth/validator';

void test('recovery boundary normalizes email and preserves a leading zero code', async () => {
  const req = {body: {email: ' Jane@Example.com ', code: '012345'}};
  for (const chain of valid.verifyRecoveryCode) await chain.run(req);
  assert.ok(validationResult(req).isEmpty());
  assert.deepEqual(req.body, {email: 'jane@example.com', code: '012345'});
});

void test('recovery boundary rejects missing, malformed, and numeric codes', async () => {
  for (const code of [undefined, 123456, '12345', '1234567', '12345a']) {
    const req = {body: {email: 'jane@example.com', code}};
    for (const chain of valid.verifyRecoveryCode) await chain.run(req);
    assert.ok(!validationResult(req).isEmpty());
  }
  const req = {body: {email: 'not an email'}};
  for (const chain of valid.sendRecoveryCode) await chain.run(req);
  assert.ok(!validationResult(req).isEmpty());
});

void test('recovery codes and reset tokens are redacted from request logs', async () => {
  const {sanitizeData} = await import('../../src/utils/helpers');
  assert.deepEqual(
    sanitizeData({
      email: 'jane@example.com',
      code: '012345',
      token: 'reset-token',
    }),
    {email: 'jane@example.com', code: 'XXX', token: 'XXX'},
  );
});
