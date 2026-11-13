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
import {createTestApp} from '../helpers/app';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';
import {createUserFixture} from '../helpers/factories';
import otp from '../../src/services/otp';
import redis from '../../src/services/redis';
import User from '../../src/module/database/model/user';

/** Just enough of Redis for the OTP service, kept in memory. */
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
  vi.spyOn(redis, 'getDel').mockImplementation((async (key: string) => {
    const value = store.get(key) ?? null;
    store.delete(key);
    return value;
  }) as never);
  vi.spyOn(redis, 'del').mockImplementation((async (key: string | string[]) => {
    for (const k of [key].flat()) store.delete(k);
    return 1;
  }) as never);
  vi.spyOn(redis, 'incr').mockImplementation((async (key: string) => {
    const next = Number(store.get(key) ?? 0) + 1;
    store.set(key, String(next));
    return next;
  }) as never);
  vi.spyOn(redis, 'expire').mockImplementation((async () => 1) as never);
}

// The auth routes allow 5 tries per address; each request gets its own.
let address = 0;
const post = (path: string, body: Record<string, unknown>) =>
  request(createTestApp())
    .post(path)
    .set('X-Forwarded-For', `198.51.100.${++address}`)
    .send(body);

const newCode = (email: string, type: 'verify' | 'reset') =>
  otp.create(email, type, {format: 'numeric', length: 6});

describe('6-digit email codes are bound to their email', () => {
  beforeAll(connectTestDatabase);
  beforeEach(fakeRedis);
  afterEach(async () => {
    vi.restoreAllMocks();
    await clearTestDatabase();
  });
  afterAll(closeTestDatabase);

  it('verifies an email only with the code and the address it was sent to', async () => {
    const user = await createUserFixture({
      email: 'new@example.com',
      verified: false,
    });
    const code = await newCode(user.email, 'verify');

    // A guessed code alone must never sign anyone in.
    const blind = await post('/auth/verify-email', {token: code});
    expect(blind.status).toBe(400);
    expect(blind.body.data?.access_token).toBeUndefined();
    expect(
      (
        await post('/auth/verify-email', {
          token: code,
          email: 'other@example.com',
        })
      ).status,
    ).toBe(400);

    const ok = await post('/auth/verify-email', {
      token: code,
      email: user.email,
    });
    expect(ok.status).toBe(200);
    expect((await User.findById(user.id).lean())?.verified).toBe(true);
  });

  it('stops accepting codes for an address after 5 wrong guesses', async () => {
    const user = await createUserFixture({
      email: 'target@example.com',
      verified: false,
    });
    const code = await newCode(user.email, 'verify');
    const wrong = code === '111111' ? '222222' : '111111';

    for (let i = 0; i < 5; i++) {
      expect(
        (await post('/auth/verify-email', {token: wrong, email: user.email}))
          .status,
      ).toBe(400);
    }

    expect(
      (await post('/auth/verify-email', {token: code, email: user.email}))
        .status,
    ).toBe(400);
  });

  it('resets a password with the code and its email', async () => {
    const user = await createUserFixture({email: 'reset@example.com'});
    const code = await newCode(user.email, 'reset');

    const response = await post('/auth/set-password', {
      token: code,
      email: user.email,
      password: 'A-new-Password-123!',
    });

    expect(response.status).toBe(200);
  });

  it('refuses a reset code sent alone unless it was just checked with its email', async () => {
    const user = await createUserFixture({email: 'old-app@example.com'});
    const code = await newCode(user.email, 'reset');
    const password = 'A-new-Password-123!';

    // Guessing straight at set-password fails.
    expect(
      (await post('/auth/set-password', {token: code, password})).status,
    ).toBe(400);

    // Older apps check the code with the email first, then send the code alone.
    const checked = await post('/auth/verify-email', {
      token: code,
      email: user.email,
      type: 'reset',
    });
    expect(checked.status).toBe(200);
    expect(
      (await post('/auth/set-password', {token: code, password})).status,
    ).toBe(200);
  });

  it('still verifies emailed links without an address', async () => {
    const user = await createUserFixture({
      email: 'link@example.com',
      verified: false,
    });
    const link = await otp.create(user.email, 'verify');

    expect((await post('/auth/verify-email', {token: link})).status).toBe(200);
  });
});
