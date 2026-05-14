/** Shared rate-limit backoff for critical chat routes (main chat + onboarding chat). */

const USER_BACKOFF_WINDOW_MS = 30_000;
const userChatBackoffUntil = new Map<string, number>();

export function isProviderRateLimited(error: unknown) {
  const msg = String((error as Error)?.message || '');
  return msg.includes('429') || msg.includes('402');
}

export function getUserBackoffRemainingMs(userId: string) {
  const until = userChatBackoffUntil.get(userId) || 0;
  const remaining = until - Date.now();
  return remaining > 0 ? remaining : 0;
}

export function setUserBackoffWindow(userId: string) {
  userChatBackoffUntil.set(userId, Date.now() + USER_BACKOFF_WINDOW_MS);
}
