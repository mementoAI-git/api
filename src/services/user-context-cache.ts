import {deleteCacheValue, getCachedJson, setCachedJson} from './redis';

/**
 * Short-lived Redis copies of context that is slow to build from the
 * database (a cross-Atlantic round trip per read, and cold reads on Atlas)
 * but changes rarely: the memory summaries and the host overview that start
 * a voice call or chat. Shared by every API process.
 *
 * Writes that change them call forgetUserContext; the TTL bounds anything a
 * write path misses. Redis being down only costs the cache.
 */

export type UserContextKind = 'memory-summaries' | 'host-overview';

const KINDS: UserContextKind[] = ['memory-summaries', 'host-overview'];
const TTL_SECONDS = 10 * 60;

const key = (kind: UserContextKind, userId: string) => `ctx:${kind}:${userId}`;

export async function cachedUserContext<T>(
  kind: UserContextKind,
  userId: string,
  load: () => Promise<T>,
): Promise<T> {
  const hit = await getCachedJson<{value: T}>(key(kind, userId));
  if (hit) return hit.value;
  const value = await load();
  void setCachedJson(key(kind, userId), {value}, TTL_SECONDS);
  return value;
}

/** Call after a write that changes a user's stories, chats, people or plans. */
export async function forgetUserContext(userId: string): Promise<void> {
  if (!userId) return;
  await Promise.all(
    KINDS.map(kind => deleteCacheValue(key(kind, String(userId)))),
  );
}
