import {decode} from 'jsonwebtoken';
import request from 'supertest';
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import type {SessionClaims} from '../../src/contracts/session';
import {createSession} from '../../src/module/api/auth/session-service';
import AuthSession from '../../src/module/database/model/auth-session';
import AiMetric from '../../src/module/database/model/ai-metric';
import User from '../../src/module/database/model/user';
import {createRefreshToken} from '../../src/utils/helpers';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';
import {createTestApp} from '../helpers/app';
import {createUserFixture} from '../helpers/factories';

describe('refresh token migration', () => {
  beforeAll(connectTestDatabase);
  afterEach(clearTestDatabase);
  afterAll(closeTestDatabase);

  it('rotates a canonical token once within the same session', async () => {
    const user = await createUserFixture();
    const first = await createSession(user, {client: 'ios'});
    const sid = (decode(first.refresh_token) as SessionClaims).sid;

    const response = await request(createTestApp())
      .post('/auth/refresh-token')
      .set('X-Memento-Client', 'ios')
      .set('X-Memento-Version', '4.2.1')
      .set('X-Memento-Build', '801')
      .send({refresh_token: first.refresh_token});

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      refresh_token: expect.any(String),
      session: {user: expect.objectContaining({id: user.id})},
    });
    expect(
      (decode(response.body.data.refresh_token) as SessionClaims).sid,
    ).toBe(sid);
    expect(await AuthSession.countDocuments({session_id: sid})).toBe(1);
    await expect
      .poll(async () =>
        AiMetric.findOne({event: 'compat.auth.legacy_session_shape'}).lean(),
      )
      .toMatchObject({
        metadata: {client: 'ios', version: '4.2.1', build: '801'},
      });

    const replay = await request(createTestApp())
      .post('/auth/refresh-token')
      .send({refresh_token: first.refresh_token});
    expect(replay.status).toBe(401);
  });

  it('atomically consumes one legacy raw token and creates a session', async () => {
    const user = await createUserFixture();
    const legacy = createRefreshToken(user.id).refresh_token;
    const untouched = createRefreshToken(user.id).refresh_token;
    await user.updateOne({
      refresh_token: legacy,
      refresh_tokens: [legacy, untouched],
    });

    const response = await request(createTestApp())
      .post('/auth/refresh-token')
      .set('X-Memento-Client', 'android')
      .set('X-Memento-Version', '4.2.1')
      .set('X-Memento-Build', '802')
      .send({refresh_token: legacy});

    expect(response.status).toBe(200);
    expect(
      (decode(response.body.data.refresh_token) as SessionClaims).sid,
    ).toEqual(expect.any(String));
    expect(response.body.data.session.user.id).toBe(user.id);
    expect(await AuthSession.countDocuments({user_id: user.id})).toBe(1);
    expect(await User.findById(user.id).lean()).toMatchObject({
      refresh_token: null,
      refresh_tokens: [untouched],
    });
    await expect
      .poll(async () =>
        AiMetric.findOne({event: 'compat.auth.legacy_refresh'}).lean(),
      )
      .toMatchObject({
        metadata: {client: 'android', version: '4.2.1', build: '802'},
      });

    const replay = await request(createTestApp())
      .post('/auth/refresh-token')
      .send({refresh_token: legacy});
    expect(replay.status).toBe(401);
  });
});
