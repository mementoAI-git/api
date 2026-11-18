import axios from 'axios';
import {sign} from 'jsonwebtoken';
import logger from '../../../../utils/logger';

/**
 * Sign in with Apple server-to-server calls. Apple requires an app that offers
 * Sign in with Apple to revoke the user's token when they delete their
 * account, which needs a refresh token (exchanged from the app's one-time
 * authorization code) and a client secret signed with a Sign in with Apple
 * key. Until APPLE_SIGNIN_KEY_ID and APPLE_SIGNIN_PRIVATE_KEY are set, these
 * calls do nothing.
 */

const APPLE = 'https://appleid.apple.com';
const APP_CLIENT_ID = 'io.mymemento.app';
const DEFAULT_TEAM_ID = 'LKYKU36B7W';
const TIMEOUT_MS = 5000;

function signingKey(): {
  keyId: string;
  privateKey: string;
  teamId: string;
} | null {
  const keyId = process.env.APPLE_SIGNIN_KEY_ID;
  const privateKey = process.env.APPLE_SIGNIN_PRIVATE_KEY?.replace(
    /\\n/g,
    '\n',
  );
  if (!keyId || !privateKey) return null;
  return {
    keyId,
    privateKey,
    teamId: process.env.APPLE_TEAM_ID || DEFAULT_TEAM_ID,
  };
}

export function appleClientSecret(clientId: string = APP_CLIENT_ID): string {
  const key = signingKey();
  if (!key) throw new Error('Sign in with Apple key is not configured');
  return sign({}, key.privateKey, {
    algorithm: 'ES256',
    keyid: key.keyId,
    issuer: key.teamId,
    subject: clientId,
    audience: APPLE,
    expiresIn: '5m',
  });
}

function form(values: Record<string, string>) {
  return new URLSearchParams(values).toString();
}

const FORM_HEADERS = {'Content-Type': 'application/x-www-form-urlencoded'};

/** Returns Apple's refresh token, or null when not configured. Throws on Apple errors. */
export async function exchangeAppleAuthorizationCode(
  code: string,
  clientId: string = APP_CLIENT_ID,
): Promise<string | null> {
  if (!signingKey()) {
    logger.warn(
      'Sign in with Apple key is not configured; Apple token not stored',
    );
    return null;
  }
  const {data} = await axios.post<{refresh_token?: string}>(
    `${APPLE}/auth/token`,
    form({
      client_id: clientId,
      client_secret: appleClientSecret(clientId),
      code,
      grant_type: 'authorization_code',
    }),
    {headers: FORM_HEADERS, timeout: TIMEOUT_MS},
  );
  return data?.refresh_token ?? null;
}

/** Returns false when not configured. Throws on Apple errors. */
export async function revokeAppleToken(
  refreshToken: string,
  clientId: string = APP_CLIENT_ID,
): Promise<boolean> {
  if (!signingKey()) {
    logger.warn(
      'Sign in with Apple key is not configured; Apple token not revoked',
    );
    return false;
  }
  await axios.post(
    `${APPLE}/auth/revoke`,
    form({
      client_id: clientId,
      client_secret: appleClientSecret(clientId),
      token: refreshToken,
      token_type_hint: 'refresh_token',
    }),
    {headers: FORM_HEADERS, timeout: TIMEOUT_MS},
  );
  return true;
}
