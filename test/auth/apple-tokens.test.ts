import {generateKeyPairSync} from 'crypto';
import axios from 'axios';
import {verify, decode} from 'jsonwebtoken';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  appleClientSecret,
  exchangeAppleAuthorizationCode,
  revokeAppleToken,
} from '../../src/module/api/auth/providers/apple-tokens';

const {privateKey, publicKey} = generateKeyPairSync('ec', {
  namedCurve: 'prime256v1',
});
const PEM = privateKey.export({format: 'pem', type: 'pkcs8'}).toString();

function configure() {
  process.env.APPLE_SIGNIN_KEY_ID = 'KEY123ABCD';
  // Server env files hold the key on one line with escaped newlines.
  process.env.APPLE_SIGNIN_PRIVATE_KEY = PEM.replace(/\n/g, '\\n');
}

function formOf(call: unknown[]) {
  return Object.fromEntries(new URLSearchParams(String(call[1])));
}

describe('Sign in with Apple tokens', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.APPLE_SIGNIN_KEY_ID;
    delete process.env.APPLE_SIGNIN_PRIVATE_KEY;
    delete process.env.APPLE_TEAM_ID;
  });

  it('signs a short-lived client secret for the app with the Sign in with Apple key', () => {
    configure();

    const secret = appleClientSecret('io.mymemento.app');

    const claims = verify(secret, publicKey, {
      algorithms: ['ES256'],
      audience: 'https://appleid.apple.com',
      issuer: 'LKYKU36B7W',
      subject: 'io.mymemento.app',
    }) as {iat: number; exp: number};
    expect(decode(secret, {complete: true})?.header.kid).toBe('KEY123ABCD');
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(600);
  });

  it("exchanges the app's authorization code for a refresh token", async () => {
    configure();
    const post = vi
      .spyOn(axios, 'post')
      .mockResolvedValue({data: {refresh_token: 'apple-refresh-1'}});

    await expect(exchangeAppleAuthorizationCode('one-time-code')).resolves.toBe(
      'apple-refresh-1',
    );

    expect(post.mock.calls[0][0]).toBe('https://appleid.apple.com/auth/token');
    expect(formOf(post.mock.calls[0])).toMatchObject({
      client_id: 'io.mymemento.app',
      code: 'one-time-code',
      grant_type: 'authorization_code',
      client_secret: expect.any(String),
    });
  });

  it('revokes a refresh token', async () => {
    configure();
    const post = vi.spyOn(axios, 'post').mockResolvedValue({data: ''});

    await revokeAppleToken('apple-refresh-1');

    expect(post.mock.calls[0][0]).toBe('https://appleid.apple.com/auth/revoke');
    expect(formOf(post.mock.calls[0])).toMatchObject({
      client_id: 'io.mymemento.app',
      token: 'apple-refresh-1',
      token_type_hint: 'refresh_token',
    });
  });

  it('does nothing until the Sign in with Apple key is configured', async () => {
    const post = vi.spyOn(axios, 'post');

    await expect(
      exchangeAppleAuthorizationCode('one-time-code'),
    ).resolves.toBeNull();
    await expect(revokeAppleToken('apple-refresh-1')).resolves.toBe(false);

    expect(post).not.toHaveBeenCalled();
  });
});
