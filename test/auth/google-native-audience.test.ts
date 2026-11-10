import request from 'supertest';
import axios from 'axios';
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';
import {createTestApp} from '../helpers/app';

// The apps' own Google OAuth clients (public identifiers, also in the mobile app).
const WEB =
  '680261459129-g1l36cheppg1e29slepth6dpvngjqjj1.apps.googleusercontent.com';
const IOS =
  '680261459129-nupaa1nhgpkolmiicmcho7ffipl939lf.apps.googleusercontent.com';
const ANDROID =
  '680261459129-android0000000000000000000000.apps.googleusercontent.com';
const OTHER_PROJECT = '246773000000-someoneelse.apps.googleusercontent.com';

const GOOGLE_ENV = [
  'GOOGLE_ID',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_WEB_CLIENT_ID',
  'GOOGLE_IOS_CLIENT_ID',
  'GOOGLE_ANDROID_CLIENT_ID',
] as const;
const saved = Object.fromEntries(
  GOOGLE_ENV.map(key => [key, process.env[key]]),
);

function setGoogleEnv(
  values: Partial<Record<(typeof GOOGLE_ENV)[number], string>>,
) {
  for (const key of GOOGLE_ENV) delete process.env[key];
  Object.assign(process.env, values);
}

/** Google's tokeninfo answer for a token with this audience and authorized party. */
function googleSays(claims: {aud: string; azp?: string}) {
  vi.spyOn(axios, 'get').mockImplementation(async (url: string) => {
    if (url.includes('oauth2.googleapis.com/tokeninfo')) {
      return {
        data: {
          sub: 'google-sub-native',
          email: 'native.google@example.com',
          given_name: 'Native',
          family_name: 'Google',
          email_verified: 'true',
          iss: 'https://accounts.google.com',
          exp: Math.floor(Date.now() / 1000) + 3600,
          ...claims,
        },
      } as never;
    }
    throw new Error(`Unexpected URL ${url}`);
  });
}

// Sign-in is limited to 5 tries per address, so each request comes from its own.
let address = 0;
const signIn = (client: 'ios' | 'android' | 'web') =>
  request(createTestApp())
    .post('/auth/oauth/google')
    .set('X-Forwarded-For', `203.0.113.${++address}`)
    .set('X-Memento-Client', client)
    .send({id_token: 'google-id-token'});

describe('Google sign-in from the apps', () => {
  beforeAll(connectTestDatabase);
  afterEach(async () => {
    vi.restoreAllMocks();
    await clearTestDatabase();
  });
  afterAll(async () => {
    setGoogleEnv(saved as Record<string, string>);
    for (const key of GOOGLE_ENV)
      if (saved[key] === undefined) delete process.env[key];
    await closeTestDatabase();
  });

  it('accepts an iPhone token even when the server only names its web client', async () => {
    // A native token's audience is the web client and its authorized party the iOS client.
    setGoogleEnv({GOOGLE_ID: WEB});
    googleSays({aud: WEB, azp: IOS});

    const response = await signIn('ios');

    expect(response.status).toBe(200);
    expect(response.body.data.user.email).toBe('native.google@example.com');
  });

  it("accepts the apps' own clients even when GOOGLE_ID is another project's", async () => {
    setGoogleEnv({GOOGLE_ID: OTHER_PROJECT});
    googleSays({aud: WEB, azp: IOS});

    expect((await signIn('ios')).status).toBe(200);
  });

  it('accepts an Android token once its client is configured', async () => {
    setGoogleEnv({GOOGLE_ID: WEB, GOOGLE_ANDROID_CLIENT_ID: ANDROID});
    googleSays({aud: WEB, azp: ANDROID});

    expect((await signIn('android')).status).toBe(200);
  });

  it('still accepts web sign-in tokens', async () => {
    setGoogleEnv({GOOGLE_ID: WEB});
    googleSays({aud: WEB, azp: WEB});

    expect((await signIn('web')).status).toBe(200);
  });

  it('rejects tokens issued to clients that are not ours', async () => {
    setGoogleEnv({GOOGLE_ID: WEB});
    googleSays({aud: OTHER_PROJECT});
    expect((await signIn('ios')).status).toBe(401);

    vi.restoreAllMocks();
    googleSays({aud: WEB, azp: OTHER_PROJECT});
    expect((await signIn('ios')).status).toBe(401);
  });
});
