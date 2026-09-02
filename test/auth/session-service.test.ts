import {decode} from 'jsonwebtoken';
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import type {RequestContext} from '../../src/contracts/response';
import type {SessionClaims} from '../../src/contracts/session';
import {
  createSession,
  hashRefreshToken,
  refreshTokenMatches,
  revokeOtherSessions,
  revokeSession,
  rotateSession,
} from '../../src/module/api/auth/session-service';
import AuthSession from '../../src/module/database/model/auth-session';
import {verifyAccessToken} from '../../src/utils/helpers';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';
import {createUserFixture} from '../helpers/factories';

const context: RequestContext = {
  requestId: 'test-request-id',
  client: 'ios',
  version: '2.4.0',
  build: '312',
};

describe('session service', () => {
  beforeAll(connectTestDatabase);
  afterEach(clearTestDatabase);
  afterAll(closeTestDatabase);

  it('stores only a hashed refresh token and emits additive token claims', async () => {
    const user = await createUserFixture({session_version: 3});
    const payload = await createSession(user, context, {
      installationId: 'ios-installation-1',
      accessExpiresIn: 60_000,
      refreshExpiresIn: 120_000,
    });
    const claims = decode(payload.access_token) as SessionClaims;
    const session = await AuthSession.findOne({session_id: claims.sid}).select(
      '+refresh_token_hash',
    );

    expect(claims).toMatchObject({id: user.id, sv: 3});
    expect(claims.sid).toEqual(expect.any(String));
    expect(session).toMatchObject({
      user_id: user.id,
      installation_id: 'ios-installation-1',
      client: 'ios',
    });
    expect(session?.refresh_token_hash).toBe(
      hashRefreshToken(payload.refresh_token),
    );
    expect(session?.refresh_token_hash).not.toBe(payload.refresh_token);
    expect(
      refreshTokenMatches(payload.refresh_token, session!.refresh_token_hash),
    ).toBe(true);
    expect(payload).toMatchObject({
      expires_at: payload.access_expires_at,
      access_expires_at: expect.any(String),
      refresh_expires_at: expect.any(String),
      onboarding_status: user.onboarding_status,
      user: expect.objectContaining({id: user.id, email: user.email}),
    });
    expect(payload.user).not.toHaveProperty('password');
  });

  it('declares unique session and expiry TTL indexes', () => {
    const indexes = AuthSession.schema.indexes();

    expect(indexes).toEqual(
      expect.arrayContaining([
        [{session_id: 1}, expect.objectContaining({unique: true})],
        [{expires_at: 1}, expect.objectContaining({expireAfterSeconds: 0})],
      ]),
    );
  });

  it('rotates a refresh token once within the same session', async () => {
    const user = await createUserFixture();
    const first = await createSession(user, context);
    const firstClaims = decode(first.refresh_token) as SessionClaims;

    const rotated = await rotateSession(first.refresh_token);
    const rotatedClaims = decode(rotated.refresh_token) as SessionClaims;
    const stored = await AuthSession.findOne({
      session_id: firstClaims.sid,
    }).select('+refresh_token_hash');

    expect(rotatedClaims.sid).toBe(firstClaims.sid);
    expect(rotated.refresh_token).not.toBe(first.refresh_token);
    expect(stored?.refresh_token_hash).toBe(
      hashRefreshToken(rotated.refresh_token),
    );
    await expect(rotateSession(first.refresh_token)).rejects.toThrow();
  });

  it('rejects refresh after revocation and can revoke other devices', async () => {
    const user = await createUserFixture();
    const current = await createSession(user, context, {
      installationId: 'current',
    });
    const other = await createSession(
      user,
      {...context, client: 'web'},
      {
        installationId: 'other',
      },
    );
    const third = await createSession(user, {...context, client: 'android'});
    const currentClaims = verifyAccessToken(
      current.access_token,
    ) as SessionClaims;
    const otherClaims = verifyAccessToken(other.access_token) as SessionClaims;

    expect(await revokeOtherSessions(user.id, currentClaims.sid!)).toBe(2);
    expect(
      await AuthSession.countDocuments({user_id: user.id, revoked_at: null}),
    ).toBe(1);
    await expect(rotateSession(third.refresh_token)).rejects.toThrow();

    expect(await revokeSession(user.id, currentClaims.sid!)).toBe(true);
    expect(await revokeSession(user.id, otherClaims.sid!)).toBe(false);
    await expect(rotateSession(current.refresh_token)).rejects.toThrow();
  });
});
