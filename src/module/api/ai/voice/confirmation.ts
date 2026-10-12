import {createHmac, timingSafeEqual} from 'crypto';

/**
 * Two-step confirmation for consequential voice actions (sending invites,
 * scheduling capsules, deleting, sending feedback). The first call returns a
 * read-back and a short code; only a second call with that code and the
 * same details runs the action, so Memento cannot skip asking the host.
 *
 * Stateless: the code is an HMAC of the host, the action, its normalised
 * details and a time window, so it works across API instances with no
 * storage. It expires after one to two windows.
 */

export const CONFIRMATION_WINDOW_MS = 2 * 60_000;
const CODE_LENGTH = 8;
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function normalise(value: unknown): unknown {
  if (typeof value === 'string') return value.trim().toLowerCase();
  if (Array.isArray(value)) return value.map(normalise);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map(key => [key, normalise((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

function details(args: Record<string, unknown>): string {
  // The code itself is not part of what it confirms.
  const rest = Object.fromEntries(
    Object.entries(args).filter(([key]) => key !== 'confirmation'),
  );
  return JSON.stringify(normalise(rest));
}

function codeFor(
  userId: string,
  tool: string,
  args: Record<string, unknown>,
  window: number,
  secret: string,
): string {
  const digest = createHmac('sha256', secret)
    .update(`${userId}|${tool}|${details(args)}|${window}`)
    .digest();
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) code += BASE32[digest[i] % 32];
  return code;
}

export function confirmationCode(
  userId: string,
  tool: string,
  args: Record<string, unknown>,
  now: number,
  secret: string,
): string {
  return codeFor(
    userId,
    tool,
    args,
    Math.floor(now / CONFIRMATION_WINDOW_MS),
    secret,
  );
}

export function isConfirmed(
  userId: string,
  tool: string,
  args: Record<string, unknown>,
  now: number,
  secret: string,
): boolean {
  const given = String(args.confirmation ?? '')
    .trim()
    .toUpperCase();
  if (given.length !== CODE_LENGTH) return false;
  const window = Math.floor(now / CONFIRMATION_WINDOW_MS);
  // This window or the previous one: a code lasts between one and two windows.
  return [window, window - 1].some(candidate => {
    const expected = codeFor(userId, tool, args, candidate, secret);
    return timingSafeEqual(Buffer.from(expected), Buffer.from(given));
  });
}
