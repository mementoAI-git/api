import {createHash, randomUUID, timingSafeEqual} from 'crypto';
import type {HydratedDocument} from 'mongoose';
import type {RequestContext} from '../../../contracts/response';
import type {SessionClaims, SessionPayload} from '../../../contracts/session';
import {toPublicUser} from '../../../contracts/public-user';
import {createTokenPair, verifyRefreshToken} from '../../../utils/helpers';
import {UnauthorizedException} from '../../../utils/service-error';
import AuthSession from '../../database/model/auth-session';
import User, {type IUser} from '../../database/model/user';

const DEFAULT_ACCESS_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type SessionOptions = {
  installationId?: string;
  accessExpiresIn?: number;
  refreshExpiresIn?: number;
};

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function refreshTokenMatches(token: string, hash: string): boolean {
  const actual = Buffer.from(hashRefreshToken(token), 'hex');
  const expected = Buffer.from(hash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function sessionPayload(
  user: HydratedDocument<IUser>,
  tokens: ReturnType<typeof createTokenPair>,
): SessionPayload {
  const onboardingStatus = user.onboarding_status || 'never';
  return {
    ...tokens,
    user: toPublicUser(user.toObject({virtuals: true})),
    onboarding_status: onboardingStatus,
  };
}

export async function createSession(
  user: HydratedDocument<IUser>,
  context: Pick<RequestContext, 'client'>,
  options: SessionOptions = {},
): Promise<SessionPayload> {
  const sessionId = randomUUID();
  const sessionVersion = user.session_version || 0;
  const tokens = createTokenPair(
    user.id,
    options.accessExpiresIn || DEFAULT_ACCESS_TTL_MS,
    options.refreshExpiresIn || DEFAULT_REFRESH_TTL_MS,
    {sid: sessionId, sv: sessionVersion},
  );

  await AuthSession.create({
    session_id: sessionId,
    user_id: user.id,
    refresh_token_hash: hashRefreshToken(tokens.refresh_token),
    installation_id: options.installationId,
    client: context.client,
    last_seen_at: new Date(),
    expires_at: new Date(tokens.refresh_expires_at),
    revoked_at: null,
  });

  return sessionPayload(user, tokens);
}

export async function rotateSession(
  refreshToken: string,
): Promise<SessionPayload> {
  const claims = verifyRefreshToken(refreshToken) as SessionClaims;
  if (!claims.sid) throw new UnauthorizedException('Invalid session');

  const session = await AuthSession.findOne({
    session_id: claims.sid,
    user_id: claims.id,
    revoked_at: null,
    expires_at: {$gt: new Date()},
  }).select('+refresh_token_hash');
  if (
    !session ||
    !refreshTokenMatches(refreshToken, session.refresh_token_hash)
  ) {
    throw new UnauthorizedException('Invalid session');
  }

  const user = await User.findById(claims.id);
  if (!user) throw new UnauthorizedException('Invalid session');

  const tokens = createTokenPair(
    user.id,
    DEFAULT_ACCESS_TTL_MS,
    Math.max(session.expires_at.getTime() - Date.now(), 1),
    {sid: session.session_id, sv: user.session_version || 0},
  );
  const nextHash = hashRefreshToken(tokens.refresh_token);
  const result = await AuthSession.updateOne(
    {
      _id: session._id,
      refresh_token_hash: session.refresh_token_hash,
      revoked_at: null,
    },
    {
      $set: {
        refresh_token_hash: nextHash,
        last_seen_at: new Date(),
        expires_at: new Date(tokens.refresh_expires_at),
      },
    },
  );
  if (result.modifiedCount !== 1) {
    throw new UnauthorizedException('Invalid session');
  }

  return sessionPayload(user, tokens);
}

export async function revokeSession(
  userId: string,
  sessionId: string,
): Promise<boolean> {
  const result = await AuthSession.updateOne(
    {user_id: userId, session_id: sessionId, revoked_at: null},
    {$set: {revoked_at: new Date()}},
  );
  return result.modifiedCount === 1;
}

export async function revokeOtherSessions(
  userId: string,
  currentSessionId: string,
): Promise<number> {
  const result = await AuthSession.updateMany(
    {
      user_id: userId,
      session_id: {$ne: currentSessionId},
      revoked_at: null,
    },
    {$set: {revoked_at: new Date()}},
  );
  return result.modifiedCount;
}
