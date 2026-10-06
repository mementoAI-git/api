import axios from 'axios';
import speakeasy from 'speakeasy';
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
import redis from '../../src/services/redis';
import otp from '../../src/services/otp';
import AuthSession from '../../src/module/database/model/auth-session';
import User from '../../src/module/database/model/user';
import {createSession} from '../../src/module/api/auth/session-service';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';
import {createUserFixture} from '../helpers/factories';

const {verifyAuthenticationResponse, verifyAppleIdentity} = vi.hoisted(() => ({
  verifyAuthenticationResponse: vi.fn(),
  verifyAppleIdentity: vi.fn(),
}));

vi.mock('@simplewebauthn/server', async importOriginal => {
  const original =
    await importOriginal<typeof import('@simplewebauthn/server')>();
  return {...original, verifyAuthenticationResponse};
});

vi.mock('../../src/module/api/auth/providers/apple', () => ({
  verifyAppleIdentity,
}));

import * as auth from '../../src/module/api/auth/service';

const context = {client: 'android' as const};

function expectCanonicalSession(data: Record<string, unknown>, userId: string) {
  expect(data).toMatchObject({
    access_token: expect.any(String),
    refresh_token: expect.any(String),
    expires_at: expect.any(String),
    session: {
      access_expires_at: expect.any(String),
      refresh_expires_at: expect.any(String),
      user: expect.objectContaining({id: userId}),
    },
  });
}

describe('authentication completion paths', () => {
  beforeAll(connectTestDatabase);
  afterEach(() => {
    vi.restoreAllMocks();
    verifyAuthenticationResponse.mockReset();
    verifyAppleIdentity.mockReset();
    return clearTestDatabase();
  });
  afterAll(closeTestDatabase);

  it('builds a canonical session after email verification', async () => {
    const user = await createUserFixture({verified: false});
    vi.spyOn(otp, 'verify').mockResolvedValue({
      valid: true,
      email: user.email,
      alreadyUsed: false,
    });
    vi.spyOn(otp, 'markUsed').mockResolvedValue(undefined);

    const result = await auth.verifyEmail(
      {
        email: user.email,
        token: 'verification-token',
      },
      context,
    );

    expectCanonicalSession(result.data, user.id);
    expect(result.data.email).toBe(user.email);
    expect((await User.findById(user.id))?.verified).toBe(true);
  });

  it('builds a canonical session after 2FA completion', async () => {
    const user = await createUserFixture({
      two_factor: {enabled: true, secret: 'totp-secret'},
    });
    vi.spyOn(redis, 'get').mockResolvedValue(
      JSON.stringify({userId: user.id, remember_for_30_days: true}),
    );
    vi.spyOn(redis, 'del').mockResolvedValue(1);
    vi.spyOn(speakeasy.totp, 'verify').mockReturnValue(true);

    const result = await auth.verify2FALogin(
      {two_fa_token: 'pending-token', code: '123456'},
      context,
    );

    expectCanonicalSession(result.data, user.id);
  });

  it('builds a canonical session after passkey completion', async () => {
    const user = await createUserFixture({
      passkeys: [
        {
          credential_id: 'credential-id',
          public_key: Buffer.from([1, 2, 3]).toString('base64'),
          counter: 0,
          device_name: 'Phone',
          created_at: new Date(),
        },
      ],
    });
    vi.spyOn(redis, 'get').mockResolvedValue('challenge');
    vi.spyOn(redis, 'del').mockResolvedValue(1);
    verifyAuthenticationResponse.mockResolvedValue({
      verified: true,
      authenticationInfo: {newCounter: 1},
    });

    const result = await auth.completePasskeyLogin(
      {challenge_id: 'challenge-id', response: {id: 'credential-id'}},
      context,
    );

    expectCanonicalSession(result.data, user.id);
  });

  it('builds canonical sessions for Google and Apple OAuth', async () => {
    const post = vi.spyOn(axios, 'post');
    const get = vi.spyOn(axios, 'get');
    post.mockResolvedValueOnce({data: {access_token: 'google-token'}});
    get.mockResolvedValueOnce({
      data: {
        id: 'google-user',
        email: 'google@example.com',
        given_name: 'Google',
        family_name: 'User',
      },
    });

    const google = await auth.oauthAuthorization(
      {code: 'google-code'},
      'google',
      context,
    );
    const googleUser = await User.findOne({email: 'google@example.com'});
    expectCanonicalSession(google.data, googleUser!.id);

    post.mockResolvedValueOnce({data: {id_token: 'apple-id-token'}});
    verifyAppleIdentity.mockResolvedValue({
      providerId: 'apple-user',
      email: 'apple@example.com',
    });
    const apple = await auth.oauthAuthorization(
      {
        code: 'apple-code',
        user: {name: {firstName: 'Apple', lastName: 'User'}},
      },
      'apple',
      context,
    );
    const appleUser = await User.findOne({email: 'apple@example.com'});
    expectCanonicalSession(apple.data, appleUser!.id);
    expect(appleUser).toMatchObject({first_name: 'Apple', last_name: 'User'});
    expect(await AuthSession.countDocuments()).toBe(2);
  });

  it('globally revokes sessions after a password reset', async () => {
    const user = await createUserFixture({
      refresh_token: 'legacy-refresh',
      refresh_tokens: ['legacy-refresh'],
    });
    await createSession(user, context);
    vi.spyOn(otp, 'consume').mockResolvedValue({
      valid: true,
      email: user.email,
      alreadyUsed: false,
    });
    vi.spyOn(otp, 'delete').mockResolvedValue(undefined);

    await auth.setPassword({
      token: 'reset-token',
      password: 'NewStrongPassword1!',
    });

    expect(await User.findById(user.id).lean()).toMatchObject({
      session_version: 1,
      refresh_token: null,
      refresh_tokens: [],
    });
    expect(
      await AuthSession.countDocuments({user_id: user.id, revoked_at: null}),
    ).toBe(0);
  });
});
