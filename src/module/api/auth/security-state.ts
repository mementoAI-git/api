import type {SessionClaims} from '../../../contracts/session';
import {
  deleteCacheValue,
  getCachedJson,
  setCachedJson,
} from '../../../services/redis';
import {UnauthorizedException} from '../../../utils/service-error';
import AuthSession from '../../database/model/auth-session';
import User from '../../database/model/user';

const CACHE_TTL_SECONDS = 30;

export type SecurityState = {
  deleted: boolean;
  disabled: boolean;
  purge_status: 'active' | 'purge_pending' | 'purged';
  session_version: number;
};

function cacheKey(userId: string): string {
  return `auth:security-state:${userId}`;
}

async function loadSecurityState(
  userId: string,
): Promise<SecurityState | null> {
  const cached = await getCachedJson<SecurityState>(cacheKey(userId));
  if (cached) return cached;

  const user = await User.findById(userId)
    .select('deleted disabled purge_status session_version')
    .lean();
  if (!user) return null;

  const state: SecurityState = {
    deleted: user.deleted === true,
    disabled: user.disabled === true,
    purge_status: user.purge_status || 'active',
    session_version: user.session_version || 0,
  };
  await setCachedJson(cacheKey(userId), state, CACHE_TTL_SECONDS);
  return state;
}

export async function invalidateSecurityState(userId: string): Promise<void> {
  await deleteCacheValue(cacheKey(userId));
}

export async function assertActiveSecurityState(
  claims: SessionClaims,
): Promise<void> {
  const state = await loadSecurityState(claims.id);
  if (
    !state ||
    state.deleted ||
    state.disabled ||
    state.purge_status !== 'active'
  ) {
    throw new UnauthorizedException('Session is no longer active');
  }

  if (claims.sv !== undefined && claims.sv !== state.session_version) {
    throw new UnauthorizedException('Session is no longer active');
  }

  if (claims.sid) {
    const activeSession = await AuthSession.exists({
      session_id: claims.sid,
      user_id: claims.id,
      revoked_at: null,
      expires_at: {$gt: new Date()},
    });
    if (!activeSession) {
      throw new UnauthorizedException('Session is no longer active');
    }
  }
}
