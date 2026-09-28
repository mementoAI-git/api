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

describe('Native OAuth id_token authorization', () => {
  beforeAll(connectTestDatabase);
  afterEach(async () => {
    vi.restoreAllMocks();
    await clearTestDatabase();
  });
  afterAll(closeTestDatabase);

  it('authenticates and creates user via Google native id_token', async () => {
    vi.spyOn(axios, 'get').mockImplementation(async (url: string) => {
      if (url.includes('oauth2.googleapis.com/tokeninfo')) {
        return {
          data: {
            sub: 'google-sub-12345',
            email: 'google.native@example.com',
            given_name: 'Google',
            family_name: 'Native',
            email_verified: 'true',
            iss: 'https://accounts.google.com',
            exp: Math.floor(Date.now() / 1000) + 3600,
            aud: '680261459129-g1l36cheppg1e29slepth6dpvngjqjj1.apps.googleusercontent.com',
          },
        } as any;
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    const response = await request(createTestApp())
      .post('/auth/oauth/google')
      .set('X-Memento-Client', 'ios')
      .send({id_token: 'mock-valid-google-id-token'});

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      access_token: expect.any(String),
      refresh_token: expect.any(String),
      user: expect.objectContaining({
        email: 'google.native@example.com',
        first_name: 'Google',
        last_name: 'Native',
      }),
    });

    const dbUser = await User.findOne({email: 'google.native@example.com'});
    expect(dbUser).toBeDefined();
    expect(dbUser?.providers).toContain('google:google-sub-12345');
  });

  it('authenticates and creates user via Apple native id_token with name', async () => {
    vi.spyOn(axios, 'get').mockImplementation(async (url: string) => {
      if (url.includes('appleid.apple.com/auth/keys')) {
        return {data: {keys: jwks}} as any;
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    const token = createAppleToken();
    const response = await request(createTestApp())
      .post('/auth/oauth/apple')
      .set('X-Memento-Client', 'ios')
      .send({
        id_token: token,
        user: {name: {firstName: 'Jane', lastName: 'Appleseed'}},
      });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      access_token: expect.any(String),
      refresh_token: expect.any(String),
      user: expect.objectContaining({
        email: 'apple.mobile@example.com',
        first_name: 'Jane',
        last_name: 'Appleseed',
      }),
    });

    const dbUser = await User.findOne({email: 'apple.mobile@example.com'});
    expect(dbUser).toBeDefined();
    expect(dbUser?.providers).toContain('apple:apple-user-mobile-1');
  });

  it('rejects when neither code nor id_token is provided', async () => {
    const response = await request(createTestApp())
      .post('/auth/oauth/google')
      .send({});

    expect(response.status).toBe(422);
    expect(response.body.message).toMatch(
      /Either authorization code or id_token is required/i,
    );
  });

  it('rejects with 401 when Google tokeninfo fails', async () => {
    vi.spyOn(axios, 'get').mockImplementation(async (url: string) => {
      if (url.includes('oauth2.googleapis.com/tokeninfo')) {
        const error: any = new Error('Invalid Value');
        error.response = {
          status: 400,
          data: {error_description: 'Invalid Value'},
        };
        throw error;
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    const response = await request(createTestApp())
      .post('/auth/oauth/google')
      .send({id_token: 'bad-token'});

    expect(response.status).toBe(401);
  });
});
