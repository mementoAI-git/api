import {beforeEach, describe, expect, it, vi} from 'vitest';

const store = vi.hoisted(() => new Map<string, string>());
vi.mock('../../src/services/redis', () => ({
  default: null,
  getCachedJson: vi.fn(async (key: string) =>
    store.has(key) ? JSON.parse(store.get(key)!) : null,
  ),
  setCachedJson: vi.fn(async (key: string, value: unknown) => {
    store.set(key, JSON.stringify(value));
  }),
  deleteCacheValue: vi.fn(async (key: string) => {
    store.delete(key);
  }),
}));

import {
  cachedUserContext,
  forgetUserContext,
} from '../../src/services/user-context-cache';

describe('user context cache', () => {
  beforeEach(() => store.clear());

  it('builds once, then serves the copy until it is forgotten', async () => {
    const load = vi.fn(async () => 'overview v1');

    expect(await cachedUserContext('host-overview', 'u1', load)).toBe(
      'overview v1',
    );
    expect(await cachedUserContext('host-overview', 'u1', load)).toBe(
      'overview v1',
    );
    expect(load).toHaveBeenCalledTimes(1);

    await forgetUserContext('u1');
    load.mockResolvedValueOnce('overview v2');
    expect(await cachedUserContext('host-overview', 'u1', load)).toBe(
      'overview v2',
    );
  });

  it('keeps users apart and caches empty results too', async () => {
    const load = vi.fn(async () => '');
    await cachedUserContext('host-overview', 'u1', load);
    await cachedUserContext('host-overview', 'u1', load);
    expect(load).toHaveBeenCalledTimes(1);

    const other = vi.fn(async () => 'theirs');
    expect(await cachedUserContext('host-overview', 'u2', other)).toBe(
      'theirs',
    );
  });

  it('never rejects when clearing fails, so writes are not affected', async () => {
    const redis = await import('../../src/services/redis');
    vi.mocked(redis.deleteCacheValue).mockRejectedValueOnce(
      new Error('redis gone'),
    );
    await expect(forgetUserContext('u1')).resolves.toBeUndefined();
  });

  it('does not cache a failed build', async () => {
    const load = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce('ok');
    await expect(
      cachedUserContext('host-overview', 'u1', load),
    ).rejects.toThrow('db down');
    expect(await cachedUserContext('host-overview', 'u1', load)).toBe('ok');
  });
});
