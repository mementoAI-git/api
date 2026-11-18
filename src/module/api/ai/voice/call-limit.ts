import {createHmac, timingSafeEqual} from 'crypto';
import {StatusCodes} from 'http-status-codes';
import {ServiceError} from '../../../../utils/service-error';

/**
 * Longest a voice call may run, from VOICE_MAX_CALL_MINUTES. Off (null) when
 * unset or 0. Read on each call so the setting changes with the environment.
 */
export function voiceCallLimitSeconds(): number | null {
  const minutes = Number(process.env.VOICE_MAX_CALL_MINUTES);
  return Number.isFinite(minutes) && minutes > 0
    ? Math.round(minutes * 60)
    : null;
}

function sign(userId: string, startedAt: number): string {
  const secret = String(process.env.JWT_SECRET || 'memento-voice-call-limit');
  return createHmac('sha256', secret)
    .update(`voice-call:${userId}:${startedAt}`)
    .digest('base64url');
}

/**
 * A call ticket records when a call started. Gemini sessions reconnect every
 * few minutes with a fresh token, and the app sends the ticket back each time,
 * so the server can tell how long the call has run without storing anything.
 */
export function issueCallTicket(userId: string, startedAt: number): string {
  return `${startedAt}.${sign(userId, startedAt)}`;
}

/** When the call started, or null for a ticket this server did not issue to this member. */
export function readCallTicket(userId: string, ticket: string): number | null {
  const [startedText, signature] = ticket.split('.');
  const startedAt = Number(startedText);
  if (!signature || !Number.isSafeInteger(startedAt)) return null;
  const expected = Buffer.from(sign(userId, startedAt));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return null;
  }
  return startedAt;
}

export type VoiceCallTime = {
  /** The per-call limit, when VOICE_MAX_CALL_MINUTES is set. */
  max_call_seconds?: number;
  call_seconds_left: number;
  call_ticket: string;
  /** Why the call ends when it does: the per-call limit, or the free plan's monthly minutes. */
  call_limit_reason: 'call' | 'free_monthly';
};

/** When the call started: the ticket's time, or now for a new call (or an unreadable ticket). */
export function callStartedAt(
  userId: string,
  ticket: unknown,
  now = Date.now(),
): number {
  return (typeof ticket === 'string' && readCallTicket(userId, ticket)) || now;
}

/**
 * The call's time allowance for a token request, or null when the call has
 * no limit. Two limits can apply: the per-call limit (VOICE_MAX_CALL_MINUTES)
 * and, on the free plan, the seconds left of the month's voice minutes
 * (freeSecondsLeft). The sooner one wins. A missing or unreadable ticket
 * starts the clock now (a new call, or an older app that does not send one).
 * A call past its per-call limit is refused.
 */
export function voiceCallTime(
  userId: string,
  ticket: unknown,
  now = Date.now(),
  freeSecondsLeft: number | null = null,
): VoiceCallTime | null {
  const limit = voiceCallLimitSeconds();
  if (!limit && freeSecondsLeft === null) return null;
  const startedAt = callStartedAt(userId, ticket, now);
  const callLeft = limit
    ? Math.min(limit, Math.round(limit - (now - startedAt) / 1000))
    : Infinity;
  if (callLeft <= 0) {
    throw new ServiceError(
      'This call has reached its time limit. Start a new call to keep talking.',
      StatusCodes.FORBIDDEN,
      {reason: 'voice_call_limit', max_call_seconds: limit},
    );
  }
  const freeFirst = freeSecondsLeft !== null && freeSecondsLeft < callLeft;
  return {
    ...(limit ? {max_call_seconds: limit} : {}),
    call_seconds_left: freeFirst ? freeSecondsLeft : callLeft,
    call_ticket:
      startedAt === now ? issueCallTicket(userId, now) : String(ticket),
    call_limit_reason: freeFirst ? 'free_monthly' : 'call',
  };
}
