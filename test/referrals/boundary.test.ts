import assert from 'node:assert/strict';
import {it as test} from 'vitest';
import {validationResult} from 'express-validator';
import valid from '../../src/module/api/auth/validator';
void test('signup and OAuth reject malformed referral input', async () => {
  for (const referral_code of [
    {$ne: null},
    ['a'.repeat(32)],
    123,
    'a'.repeat(33),
  ]) {
    const req = {
      body: {
        email: 'test@example.com',
        password: 'Password1!',
        first_name: 'New',
        last_name: 'Friend',
        code: 'oauth-code',
        referral_code,
      },
      params: {provider: 'google'},
    };
    for (const chain of valid.register) await chain.run(req);
    assert.ok(!validationResult(req).isEmpty());
    for (const chain of valid.authorization) await chain.run(req);
    assert.ok(!validationResult(req).isEmpty());
  }
});
void test('referral is optional and valid codes survive validation', async () => {
  for (const referral_code of [undefined, 'a'.repeat(32)]) {
    const req = {
      body: {
        email: 'test@example.com',
        password: 'Password1!',
        first_name: 'New',
        last_name: 'Friend',
        referral_code,
      },
    };
    for (const chain of valid.register) await chain.run(req);
    assert.ok(validationResult(req).isEmpty());
  }
});
