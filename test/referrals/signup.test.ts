import request from 'supertest';
import axios from 'axios';
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
import {
  connectTestDatabase,
  clearTestDatabase,
  closeTestDatabase,
} from '../helpers/database';
import {createTestApp} from '../helpers/app';
import {createUserFixture, issueLegacyAccessToken} from '../helpers/factories';
import User from '../../src/module/database/model/user';
import mail from '../../src/module/mail';

vi.hoisted(() => {
  process.env.FRONTEND_URL = 'https://dev.mymemento.io';
  // The mocked ID-token audience must not inherit a developer's OAuth client.
  process.env.GOOGLE_ID =
    '680261459129-g1l36cheppg1e29slepth6dpvngjqjj1.apps.googleusercontent.com';
});

describe('personal invite signup tracking', () => {
  beforeAll(connectTestDatabase);
  afterEach(async () => {
    vi.restoreAllMocks();
    await clearTestDatabase();
  });
  afterAll(closeTestDatabase);

  async function inviter() {
    const user = await createUserFixture();
    const app = createTestApp();
    const token = issueLegacyAccessToken(user);
    const response = await request(app)
      .get('/users/referrals')
      .auth(token, {type: 'bearer'});
    expect(response.status).toBe(200);
    expect(response.body.data.signup_count).toBe(0);
    const link = new URL(response.body.data.invite_url);
    expect(link.origin).toBe('https://dev.mymemento.io');
    return {
      user,
      app,
      token,
      code: link.searchParams.get('ref'),
      url: link.toString(),
    };
  }

  it('keeps concurrent links stable and counts an email signup exactly once', async () => {
    const {user, app, token, code, url} = await inviter();
    const responses = await Promise.all(
      Array.from({length: 5}, () =>
        request(app).get('/users/referrals').auth(token, {type: 'bearer'}),
      ),
    );
    expect(
      responses.every(response => response.body.data.invite_url === url),
    ).toBe(true);
    vi.spyOn(mail, 'sendLink').mockResolvedValue({
      code: '123456',
      expires_at: new Date().toISOString(),
    });
    const payload = {
      email: 'invited@example.com',
      password: 'Password1!',
      first_name: 'New',
      last_name: 'Friend',
      referral_code: code,
    };
    expect(
      (
        await request(app)
          .post('/auth/register')
          .set('X-Memento-Client', 'web')
          .send(payload)
      ).status,
    ).toBe(200);
    const invited = await User.findOne({email: payload.email}).select(
      '+referred_by',
    );
    expect(String(invited?.referred_by)).toBe(String(user._id));
    expect(
      (await request(app).post('/auth/register').send(payload)).status,
    ).not.toBe(200);
    const summary = await request(app)
      .get('/users/referrals')
      .auth(token, {type: 'bearer'});
    expect(summary.body.data).toEqual({invite_url: url, signup_count: 1});
    expect(
      (await request(app).get('/users/profile').auth(token, {type: 'bearer'}))
        .body.data,
    ).not.toHaveProperty('referral_code');
  });

  it('attributes a new Google signup and never reattributes an existing account', async () => {
    const {user, app, token, code} = await inviter();
    vi.spyOn(axios, 'get').mockResolvedValue({
      data: {
        sub: 'referral-google-sub',
        email: 'google-friend@example.com',
        given_name: 'Google',
        family_name: 'Friend',
        email_verified: 'true',
        iss: 'https://accounts.google.com',
        exp: Math.floor(Date.now() / 1000) + 3600,
        aud: '680261459129-g1l36cheppg1e29slepth6dpvngjqjj1.apps.googleusercontent.com',
      },
    });
    const signup = await request(app)
      .post('/auth/oauth/google')
      .set('X-Memento-Client', 'web')
      .send({id_token: 'provider-test-token', referral_code: code});
    expect(signup.status).toBe(200);
    const other = await createUserFixture();
    const otherLink = await request(app)
      .get('/users/referrals')
      .auth(issueLegacyAccessToken(other), {type: 'bearer'});
    const otherCode = new URL(otherLink.body.data.invite_url).searchParams.get(
      'ref',
    );
    expect(
      (
        await request(app)
          .post('/auth/oauth/google')
          .set('X-Memento-Client', 'web')
          .send({id_token: 'provider-test-token', referral_code: otherCode})
      ).status,
    ).toBe(200);
    expect(
      String(
        (
          await User.findOne({email: 'google-friend@example.com'}).select(
            '+referred_by',
          )
        )?.referred_by,
      ),
    ).toBe(String(user._id));
    expect(
      (await request(app).get('/users/referrals').auth(token, {type: 'bearer'}))
        .body.data.signup_count,
    ).toBe(1);
    expect(
      (
        await request(app)
          .get('/users/referrals')
          .auth(issueLegacyAccessToken(other), {type: 'bearer'})
      ).body.data.signup_count,
    ).toBe(0);
  });

  it('requires authentication and accepts unknown links without creating attribution', async () => {
    const app = createTestApp();
    expect((await request(app).get('/users/referrals')).status).toBe(401);
    vi.spyOn(mail, 'sendLink').mockResolvedValue({
      code: '123456',
      expires_at: new Date().toISOString(),
    });
    const response = await request(app)
      .post('/auth/register')
      .send({
        email: 'unknown-link@example.com',
        password: 'Password1!',
        first_name: 'New',
        last_name: 'Friend',
        referral_code: 'a'.repeat(32),
      });
    expect(response.status).toBe(200);
    expect(
      (
        await User.findOne({email: 'unknown-link@example.com'}).select(
          '+referred_by',
        )
      )?.referred_by,
    ).toBeUndefined();
  });
});
