import {createHmac, timingSafeEqual} from 'crypto';
import {
  BACKEND_URL,
  FILE_URL_SIGNING_KEYS,
  FILE_URL_TTL_SECONDS,
} from '../../utils/config';

export type FileVariant = 'original' | 'thumbnail';

export type FileCapability = {
  fid: string;
  exp: number;
  kid: string;
  sig: string;
  variant: FileVariant;
};

type SigningKey = {id: string; secret: string};

function parseSigningKeys(raw: string): SigningKey[] {
  return raw
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
    .map(value => {
      const separator = value.indexOf(':');
      if (separator <= 0 || separator === value.length - 1) {
        throw new Error('Invalid file signing key configuration');
      }
      return {
        id: value.slice(0, separator),
        secret: value.slice(separator + 1),
      };
    });
}

function signingPayload(input: {
  fileId: string;
  objectKey: string;
  variant: FileVariant;
  exp: number;
  kid: string;
}): string {
  return [
    input.fileId,
    input.objectKey,
    input.variant,
    input.exp,
    input.kid,
  ].join('\n');
}

function signatureFor(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function signFileUrl(input: {
  fileId: string;
  objectKey: string;
  variant: FileVariant;
  ttlSeconds?: number;
}): {url: string; expiresAt: string} {
  const [key] = parseSigningKeys(FILE_URL_SIGNING_KEYS);
  if (!key) throw new Error('File signing key is not configured');
  if (!BACKEND_URL) throw new Error('Backend URL is not configured');

  const exp =
    Math.floor(Date.now() / 1000) + (input.ttlSeconds ?? FILE_URL_TTL_SECONDS);
  const payload = signingPayload({...input, exp, kid: key.id});
  const params = new URLSearchParams({
    fid: input.fileId,
    exp: String(exp),
    kid: key.id,
    variant: input.variant,
    sig: signatureFor(payload, key.secret),
  });
  const baseUrl = BACKEND_URL.replace(/\/$/, '');

  return {
    url: `${baseUrl}/files/${encodeURIComponent(input.objectKey)}?${params}`,
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}

export function verifyFileCapability(input: {
  fileId: string;
  objectKey: string;
  variant: FileVariant;
  exp: number;
  kid: string;
  signature: string;
  now?: number;
}): boolean {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(input.exp) || input.exp <= now) return false;

  const key = parseSigningKeys(FILE_URL_SIGNING_KEYS).find(
    candidate => candidate.id === input.kid,
  );
  if (!key) return false;

  const expected = Buffer.from(
    signatureFor(signingPayload(input), key.secret),
    'base64url',
  );
  const actual = Buffer.from(input.signature, 'base64url');
  if (expected.length !== actual.length) return false;

  return timingSafeEqual(expected, actual);
}
