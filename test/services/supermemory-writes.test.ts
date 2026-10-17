import {describe, expect, it, vi} from 'vitest';

const add = vi.fn(async () => ({}));
vi.mock('supermemory', () => ({
  // Constructed with `new`, so a function rather than an arrow.
  // eslint-disable-next-line prefer-arrow-callback
  default: vi.fn(function () {
    return {add, documents: {deleteBulk: vi.fn()}};
  }),
}));

describe('approved insights and Supermemory', () => {
  it('sends nothing while retrieval is in-house', async () => {
    vi.resetModules();
    vi.stubEnv('SUPERMEMORY_API_KEY', 'test-key');
    vi.stubEnv('MEMORY_RETRIEVAL', '');
    const {addApprovedMemory} = await import('../../src/services/supermemory');
    await addApprovedMemory('u1', 'Loves jollof rice');
    expect(add).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it('still writes when Supermemory is explicitly the store', async () => {
    vi.resetModules();
    vi.stubEnv('SUPERMEMORY_API_KEY', 'test-key');
    vi.stubEnv('MEMORY_RETRIEVAL', 'supermemory');
    const {addApprovedMemory} = await import('../../src/services/supermemory');
    await addApprovedMemory('u1', 'Loves jollof rice');
    expect(add).toHaveBeenCalledTimes(1);
    vi.unstubAllEnvs();
  });
});
