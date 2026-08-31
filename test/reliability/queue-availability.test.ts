import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('../../src/services/redis', () => ({
  getRedisConnection: () => null,
}));

const {logger} = vi.hoisted(() => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('../../src/utils/logger', () => ({default: logger}));
vi.mock('../../src/utils', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/utils')>()),
  logger,
}));

import {initializeCapsuleReveal} from '../../src/services/queues/system';

describe('queue availability guards', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not dereference the capsule scheduler when Redis is unavailable', async () => {
    await expect(initializeCapsuleReveal()).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringMatching(/capsule reveal/i),
    );
  });
});
