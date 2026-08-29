import express from 'express';
import {decode} from 'jsonwebtoken';
import request from 'supertest';
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import requestContext from '../../src/middleware/request-context';
import guard from '../../src/middleware/gaurd';
import errorHandler from '../../src/middleware/error-handler';
import {
  createSession,
  revokeSession,
} from '../../src/module/api/auth/session-service';
import {invalidateSecurityState} from '../../src/module/api/auth/security-state';
import {deleteUser} from '../../src/module/api/user/service';
import AuthSession from '../../src/module/database/model/auth-session';
import User from '../../src/module/database/model/user';
import type {RequestContext} from '../../src/contracts/response';
import type {SessionClaims} from '../../src/contracts/session';
import type {IRequest} from '../../src/utils/interface';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestReplicaSet,
} from '../helpers/database';
import {createUserFixture, issueLegacyAccessToken} from '../helpers/factories';

const context: RequestContext = {
  requestId: 'test-request-id',
  client: 'ios',
  version: '2.4.0',
  build: '312',
};

function protectedApp() {
  const app = express();
  app.use(requestContext);
  app.get('/protected', guard, (req, res) => {
    res.status(200).json({id: (req as IRequest).auth?.id});
  });
  app.use(errorHandler);
  return app;
}

async function protectedRequest(token: string) {
  return request(protectedApp())
    .get('/protected')
    .set('Authorization', `Bearer ${token}`);
}

describe('session revocation enforcement', () => {
  beforeAll(connectTestReplicaSet);
  afterEach(clearTestDatabase);
  afterAll(closeTestDatabase);

  it('accepts active canonical and legacy sessions', async () => {
    const user = await createUserFixture();
    const canonical = await createSession(user, context);

    expect((await protectedRequest(canonical.access_token)).status).toBe(200);
    expect((await protectedRequest(issueLegacyAccessToken(user))).status).toBe(
      200,
    );
  });

  it.each([
    {deleted: true},
    {disabled: true},
    {purge_status: 'purge_pending' as const},
    {purge_status: 'purged' as const},
  ])('rejects inactive account state %o', async state => {
    const user = await createUserFixture(state);
    const response = await protectedRequest(issueLegacyAccessToken(user));

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({
      success: false,
      code: 'unauthorized',
    });
  });

  it('rejects version-mismatched and revoked canonical sessions', async () => {
    const user = await createUserFixture({session_version: 4});
    const versioned = await createSession(user, context);
    await user.updateOne({$inc: {session_version: 1}});
    await invalidateSecurityState(user.id);

    expect((await protectedRequest(versioned.access_token)).status).toBe(401);

    const freshUser = await createUserFixture();
    const revoked = await createSession(freshUser, context);
    const sessionId = (decode(revoked.access_token) as SessionClaims).sid!;
    await revokeSession(freshUser.id, sessionId);
    await invalidateSecurityState(freshUser.id);

    expect((await protectedRequest(revoked.access_token)).status).toBe(401);
  });

  it('falls back to MongoDB when Redis is unavailable', async () => {
    const user = await createUserFixture();
    const token = issueLegacyAccessToken(user);

    expect((await protectedRequest(token)).status).toBe(200);
    await user.updateOne({deleted: true});
    await invalidateSecurityState(user.id);
    expect((await protectedRequest(token)).status).toBe(401);
  });

  it('globally revokes access before account deletion returns', async () => {
    const user = await createUserFixture({
      refresh_token: 'legacy-refresh',
      refresh_tokens: ['legacy-refresh'],
    });
    const legacyAccess = issueLegacyAccessToken(user);
    const canonical = await createSession(user, context);

    await deleteUser(user.id);

    expect((await protectedRequest(legacyAccess)).status).toBe(401);
    expect((await protectedRequest(canonical.access_token)).status).toBe(401);
    expect(
      await AuthSession.countDocuments({user_id: user.id, revoked_at: null}),
    ).toBe(0);
    expect(await User.findById(user.id).lean()).toMatchObject({
      deleted: true,
      purge_status: 'purge_pending',
      session_version: 1,
      refresh_token: null,
      refresh_tokens: [],
    });
  });
});
