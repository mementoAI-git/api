import axios from 'axios';
import speakeasy from 'speakeasy';
import request from 'supertest';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';
import {createTestApp} from '../helpers/app';
import {createUserFixture} from '../helpers/factories';
import redis from '../../src/services/redis';
import mail from '../../src/module/mail';
import User from '../../src/module/database/model/user';
import {deleteUser} from '../../src/module/api/user/service';

const WEB =
  '680261459129-g1l36cheppg1e29slepth6dpvngjqjj1.apps.googleusercontent.com';

/** The pending 2FA step lives in Redis; keep it in memory here. */
function fakeRedis() {
  const store = new Map<string, string>();
  vi.spyOn(redis, 'get').mockImplementation(
    (async (key: string) => store.get(key) ?? null) as never,
  );
  vi.spyOn(redis, 'set').mockImplementation((async (
    key: string,
    value: string,
  ) => {
    store.set(key, String(value));
    return 'OK';
  }) as never);
  vi.spyOn(redis, 'del').mockImplementation((async (key: string) => {
    store.delete(key);
    return 1;
  }) as never);
}

function googleSaysItIs(email: string) {
  vi.spyOn(axios, 'get').mockImplementation(async (url: string) => {
    if (!url.includes('oauth2.googleapis.com/tokeninfo')) throw new Error(url);
    return {
      data: {
        sub: 'google-sub-2fa',
        email,
        email_verified: 'true',
        iss: 'https://accounts.google.com',
        exp: Math.floor(Date.now() / 1000) + 3600,
        aud: WEB,
      },
    } as never;
  });
}

let address = 0;
const post = (path: string, body: Record<string, unknown>) =>
  request(createTestApp())
    .post(path)
    .set('X-Forwarded-For', `192.0.2.${++address}`)
    .set('X-Memento-Client', 'ios')
    .send(body);

describe('Google and Apple sign-in respect two-factor authentication', () => {
  beforeAll(connectTestDatabase);
  beforeEach(fakeRedis);
  afterEach(async () => {
    vi.restoreAllMocks();
    await clearTestDatabase();
  });
  afterAll(closeTestDatabase);

  it('asks for the authenticator code before giving a session', async () => {
    const secret = speakeasy.generateSecret().base32;
    const user = await createUserFixture({
      email: 'twofactor@example.com',
      two_factor: {secret, enabled: true},
    } as never);
    googleSaysItIs(user.email);

    const signIn = await post('/auth/oauth/google', {
      id_token: 'google-id-token',
    });

    expect(signIn.status).toBe(200);
    expect(signIn.body.data).toMatchObject({
      requires_2fa: true,
      two_fa_token: expect.any(String),
    });
    expect(signIn.body.data.access_token).toBeUndefined();

    const verified = await post('/auth/2fa/verify', {
      two_fa_token: signIn.body.data.two_fa_token,
      code: speakeasy.totp({secret, encoding: 'base32'}),
    });
    expect(verified.status).toBe(200);
    expect(verified.body.data.access_token).toEqual(expect.any(String));
  });

  it('restores a deactivated account only after the 2FA code', async () => {
    // Signing in during the deletion grace period restores the account; with
    // 2FA on, that must wait for the code, not happen at the Google step.
    vi.spyOn(mail, 'sendAccountDeactivated').mockResolvedValue(undefined);
    const secret = speakeasy.generateSecret().base32;
    const user = await createUserFixture({
      email: 'leaving@example.com',
      two_factor: {secret, enabled: true},
    } as never);
    await deleteUser(user.id);
    googleSaysItIs(user.email);

    const signIn = await post('/auth/oauth/google', {
      id_token: 'google-id-token',
    });

    expect(signIn.body.data).toMatchObject({requires_2fa: true});
    expect((await User.findById(user.id).lean())?.deleted).toBe(true);

    const verified = await post('/auth/2fa/verify', {
      two_fa_token: signIn.body.data.two_fa_token,
      code: speakeasy.totp({secret, encoding: 'base32'}),
    });
    expect(verified.status).toBe(200);
    expect((await User.findById(user.id).lean())?.deleted).toBe(false);
  });

  it('signs in straight away when two-factor authentication is off', async () => {
    const user = await createUserFixture({email: 'plain@example.com'});
    googleSaysItIs(user.email);

    const signIn = await post('/auth/oauth/google', {
      id_token: 'google-id-token',
    });

    expect(signIn.status).toBe(200);
    expect(signIn.body.data.access_token).toEqual(expect.any(String));
  });
});
