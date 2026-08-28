import bcrypt from 'bcryptjs';
import request from 'supertest';
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
import AuthSession from '../../src/module/database/model/auth-session';
import mail from '../../src/module/mail';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';
import {createTestApp} from '../helpers/app';
import {createUserFixture} from '../helpers/factories';

describe('authentication contract', () => {
  beforeAll(connectTestDatabase);
  afterEach(() => {
    vi.restoreAllMocks();
    return clearTestDatabase();
  });
  afterAll(closeTestDatabase);

  it('adds a canonical session while retaining legacy login fields', async () => {
    const password = 'StrongPassword1!';
    const user = await createUserFixture({
      password: await bcrypt.hash(password, 10),
      onboarding_status: 'in_progress',
    });

    const response = await request(createTestApp())
      .post('/auth/login')
      .set('X-Memento-Client', 'ios')
      .set('X-Memento-Version', '2.4.0')
      .set('X-Memento-Build', '312')
      .send({email: user.email, password});

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      access_token: expect.any(String),
      refresh_token: expect.any(String),
      expires_at: expect.any(String),
      onboarding_status: 'in_progress',
      onboarded: false,
      session: {
        access_token: expect.any(String),
        refresh_token: expect.any(String),
        access_expires_at: expect.any(String),
        refresh_expires_at: expect.any(String),
        onboarding_status: 'in_progress',
        user: expect.objectContaining({id: user.id, email: user.email}),
      },
    });
    expect(response.body.data.session.user).not.toHaveProperty('password');
    expect(await AuthSession.countDocuments({user_id: user.id})).toBe(1);
  });

  it('keeps registration verification-only and uses its full validator', async () => {
    vi.spyOn(mail, 'sendLink').mockResolvedValue(undefined);

    const invalid = await request(createTestApp()).post('/auth/register').send({
      email: 'new-user@example.com',
      password: 'StrongPassword1!',
    });
    expect(invalid.status).toBe(422);

    const response = await request(createTestApp())
      .post('/auth/register')
      .send({
        email: 'new-user@example.com',
        first_name: 'New',
        last_name: 'User',
        password: 'StrongPassword1!',
      });
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      requires_verification: true,
      email: 'new-user@example.com',
    });
    expect(response.body.data).not.toHaveProperty('session');
    expect(await AuthSession.countDocuments()).toBe(0);
  });
});
