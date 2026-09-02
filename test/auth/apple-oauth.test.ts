import {generateKeyPairSync} from 'crypto';
import {sign} from 'jsonwebtoken';
import {describe, expect, it} from 'vitest';
import {verifyAppleIdentity} from '../../src/module/api/auth/providers/apple';

const audience = 'com.memento.app';
const {privateKey, publicKey} = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const publicJwk = publicKey.export({format: 'jwk'});
const jwks = [{...publicJwk, kid: 'apple-test-key', alg: 'RS256', use: 'sig'}];

function appleToken(overrides: Record<string, unknown> = {}) {
  return sign(
    {
      sub: 'apple-user-1',
      email: 'apple-user@example.com',
      email_verified: 'true',
      aud: audience,
      iss: 'https://appleid.apple.com',
      exp: Math.floor(Date.now() / 1000) + 300,
      ...overrides,
    },
    privateKey,
    {
      algorithm: 'RS256',
      keyid: 'apple-test-key',
    },
  );
}

describe('Apple identity verification', () => {
  it('verifies signature, issuer, audience, and expiry', async () => {
    await expect(
      verifyAppleIdentity(appleToken(), {
        audience,
        loadJwks: async () => jwks,
      }),
    ).resolves.toEqual({
      providerId: 'apple-user-1',
      email: 'apple-user@example.com',
    });
  });

  it('rejects the wrong audience, issuer, expiry, and signature', async () => {
    const options = {audience, loadJwks: async () => jwks};
    const wrongAudience = appleToken({aud: 'another-app'});
    const wrongIssuer = appleToken({iss: 'https://attacker.example'});
    const expired = appleToken({exp: Math.floor(Date.now() / 1000) - 10});
    const tokenParts = appleToken().split('.');
    tokenParts[2] = `${tokenParts[2][0] === 'a' ? 'b' : 'a'}${tokenParts[2].slice(1)}`;
    const tampered = tokenParts.join('.');

    await expect(verifyAppleIdentity(wrongAudience, options)).rejects.toThrow();
    await expect(verifyAppleIdentity(wrongIssuer, options)).rejects.toThrow();
    await expect(verifyAppleIdentity(expired, options)).rejects.toThrow();
    await expect(verifyAppleIdentity(tampered, options)).rejects.toThrow();
  });
});
