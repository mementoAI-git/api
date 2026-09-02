import {decode} from 'jsonwebtoken';
import request from 'supertest';
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import type {SessionClaims} from '../../src/contracts/session';
import {createSession} from '../../src/module/api/auth/session-service';
import AuthSession from '../../src/module/database/model/auth-session';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';
import {createTestApp} from '../helpers/app';
import {createUserFixture} from '../helpers/factories';

describe('device-scoped logout', () => {
  beforeAll(connectTestDatabase);
  afterEach(clearTestDatabase);
  afterAll(closeTestDatabase);

  it('logs out the authenticated canonical device without a body', async () => {
    const user = await createUserFixture();
    const current = await createSession(user, {client: 'ios'});
    const other = await createSession(user, {client: 'web'});
    const currentSid = (decode(current.access_token) as SessionClaims).sid;
    const otherSid = (decode(other.access_token) as SessionClaims).sid;

    const response = await request(createTestApp())
      .delete('/auth/logout')
      .set('Authorization', `Bearer ${current.access_token}`);

    expect(response.status).toBe(200);
    expect(
      await AuthSession.findOne({session_id: currentSid}).lean(),
    ).toMatchObject({revoked_at: expect.any(Date)});
    expect(
      await AuthSession.findOne({session_id: otherSid}).lean(),
    ).toMatchObject({revoked_at: null});
  });

  it('logs out other devices while retaining the authenticated session', async () => {
    const user = await createUserFixture();
    const current = await createSession(user, {client: 'android'});
    await createSession(user, {client: 'ios'});
    await createSession(user, {client: 'web'});
    const currentSid = (decode(current.access_token) as SessionClaims).sid;

    const response = await request(createTestApp())
      .delete('/auth/logout/other')
      .set('Authorization', `Bearer ${current.access_token}`);

    expect(response.status).toBe(200);
    expect(
      await AuthSession.countDocuments({user_id: user.id, revoked_at: null}),
    ).toBe(1);
    expect(
      await AuthSession.findOne({session_id: currentSid}).lean(),
    ).toMatchObject({revoked_at: null});
  });

  it('rejects a refresh token from a different canonical session', async () => {
    const user = await createUserFixture();
    const current = await createSession(user, {client: 'ios'});
    const other = await createSession(user, {client: 'web'});

    const response = await request(createTestApp())
      .delete('/auth/logout')
      .set('Authorization', `Bearer ${current.access_token}`)
      .send({refresh_token: other.refresh_token});

    expect(response.status).toBe(401);
    expect(
      await AuthSession.countDocuments({user_id: user.id, revoked_at: null}),
    ).toBe(2);
  });
});
