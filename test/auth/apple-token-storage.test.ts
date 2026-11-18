import {generateKeyPairSync} from 'crypto';
import {sign} from 'jsonwebtoken';
import request from 'supertest';
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
import axios from 'axios';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';
import {createTestApp} from '../helpers/app';
import User from '../../src/module/database/model/user';
import {decryptStoreSecret} from '../../src/module/api/billing/providers/token-vault';

vi.hoisted(() => {
  // Keep the mocked Google audience independent of a developer's local client.
  process.env.GOOGLE_ID =
    '680261459129-g1l36cheppg1e29slepth6dpvngjqjj1.apps.googleusercontent.com';
});

const audience = 'io.mymemento.app';
const {privateKey, publicKey} = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const publicJwk = publicKey.export({format: 'jwk'});
const jwks = [{...publicJwk, kid: 'apple-test-key', alg: 'RS256', use: 'sig'}];

function createAppleToken(overrides: Record<string, unknown> = {}) {
  return sign(
    {
      sub: 'apple-user-mobile-1',
      email: 'apple.mobile@example.com',
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

describe('Sign in with Apple token storage', () => {
  beforeAll(connectTestDatabase);
  afterEach(async () => {
    vi.restoreAllMocks();
    await clearTestDatabase();
  });
  afterAll(closeTestDatabase);

  it("stores Apple's refresh token, encrypted, when the app sends its authorization code", async () => {
    process.env.IAP_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString(
      'base64',
    );
    const {privateKey: signingKey} = generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
    });
    process.env.APPLE_SIGNIN_KEY_ID = 'KEY123ABCD';
    process.env.APPLE_SIGNIN_PRIVATE_KEY = signingKey
      .export({format: 'pem', type: 'pkcs8'})
      .toString();
    vi.spyOn(axios, 'get').mockResolvedValue({data: {keys: jwks}} as any);
    vi.spyOn(axios, 'post').mockResolvedValue({
      data: {refresh_token: 'apple-refresh-1'},
    } as any);

    const response = await request(createTestApp())
      .post('/auth/oauth/apple')
      .set('X-Memento-Client', 'ios')
      .send({id_token: createAppleToken(), code: 'one-time-code'});

    expect(response.status).toBe(200);
    const dbUser = await User.findOne({email: 'apple.mobile@example.com'})
      .select('+apple_refresh_token')
      .lean()
      .orFail();
    expect(dbUser.apple_refresh_token).toBeTruthy();
    expect(dbUser.apple_refresh_token).not.toContain('apple-refresh-1');
    expect(decryptStoreSecret(dbUser.apple_refresh_token!)).toBe(
      'apple-refresh-1',
    );
    delete process.env.APPLE_SIGNIN_KEY_ID;
    delete process.env.APPLE_SIGNIN_PRIVATE_KEY;
  });

  it('still signs in when Apple rejects the authorization code', async () => {
    process.env.APPLE_SIGNIN_KEY_ID = 'KEY123ABCD';
    process.env.APPLE_SIGNIN_PRIVATE_KEY = generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
    })
      .privateKey.export({format: 'pem', type: 'pkcs8'})
      .toString();
    vi.spyOn(axios, 'get').mockResolvedValue({data: {keys: jwks}} as any);
    vi.spyOn(axios, 'post').mockRejectedValue(new Error('invalid_grant'));

    const response = await request(createTestApp())
      .post('/auth/oauth/apple')
      .set('X-Memento-Client', 'ios')
      .send({id_token: createAppleToken(), code: 'expired-code'});

    expect(response.status).toBe(200);
    delete process.env.APPLE_SIGNIN_KEY_ID;
    delete process.env.APPLE_SIGNIN_PRIVATE_KEY;
  });
});
