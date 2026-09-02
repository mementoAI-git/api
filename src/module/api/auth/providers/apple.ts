import {createPublicKey, type JsonWebKey} from 'crypto';
import axios from 'axios';
import {decode, verify, type JwtPayload} from 'jsonwebtoken';
import {APPLE_ID} from '../../../../utils/config';
import {UnauthorizedException} from '../../../../utils/service-error';

const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_JWKS_URL = `${APPLE_ISSUER}/auth/keys`;
const JWKS_TTL_MS = 60 * 60 * 1000;

type AppleJwk = JsonWebKey & {kid?: string; alg?: string; use?: string};
type AppleJwksLoader = () => Promise<AppleJwk[]>;

type VerifyAppleOptions = {
  audience?: string;
  loadJwks?: AppleJwksLoader;
};

let cachedJwks: {keys: AppleJwk[]; expiresAt: number} | null = null;

async function loadAppleJwks(): Promise<AppleJwk[]> {
  if (cachedJwks && cachedJwks.expiresAt > Date.now()) return cachedJwks.keys;
  const response = await axios.get<{keys: AppleJwk[]}>(APPLE_JWKS_URL, {
    timeout: 5000,
  });
  cachedJwks = {keys: response.data.keys, expiresAt: Date.now() + JWKS_TTL_MS};
  return cachedJwks.keys;
}

export async function verifyAppleIdentity(
  idToken: string,
  options: VerifyAppleOptions = {},
): Promise<{providerId: string; email: string}> {
  const audience = options.audience || APPLE_ID;
  if (!audience) throw new UnauthorizedException('Apple OAuth is unavailable');

  try {
    const unverified = decode(idToken, {complete: true});
    if (!unverified || unverified.header.alg !== 'RS256') {
      throw new Error('Invalid Apple token header');
    }

    const keys = await (options.loadJwks || loadAppleJwks)();
    const jwk = keys.find(key => key.kid === unverified.header.kid);
    if (!jwk) throw new Error('Unknown Apple signing key');

    const publicKey = createPublicKey({key: jwk, format: 'jwk'});
    const claims = verify(idToken, publicKey, {
      algorithms: ['RS256'],
      issuer: APPLE_ISSUER,
      audience,
    }) as JwtPayload;
    if (typeof claims.sub !== 'string' || typeof claims.email !== 'string') {
      throw new Error('Apple identity is incomplete');
    }

    return {providerId: claims.sub, email: claims.email.toLowerCase()};
  } catch {
    throw new UnauthorizedException('Invalid Apple identity token');
  }
}
