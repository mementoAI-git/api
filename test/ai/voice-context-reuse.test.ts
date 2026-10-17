import {beforeEach, describe, expect, it, vi} from 'vitest';

const store = new Map<string, unknown>();
vi.mock('../../src/services/redis', () => ({
  default: null,
  getRedisConnection: () => null,
  getCachedJson: async (key: string) => store.get(key) ?? null,
  setCachedJson: async (key: string, value: unknown) => {
    store.set(key, value);
  },
  deleteCacheValue: async (key: string) => {
    store.delete(key);
  },
}));

import {
  voiceContextKey,
  voiceSessionContextFor,
  type VoiceSessionContext,
} from '../../src/module/api/ai/voice/session-context';

const user = {_id: 'u1'} as never;

function builder() {
  let builds = 0;
  const build = vi.fn(async (): Promise<VoiceSessionContext> => {
    builds += 1;
    return {
      systemInstruction: `context ${builds}`,
      greetingInstruction: 'Greet them.',
      memoryId: 'm1',
    };
  });
  return build;
}

describe('voiceSessionContextFor', () => {
  beforeEach(() => store.clear());

  it('a reconnect reuses the context its call started with', async () => {
    const build = builder();
    const first = await voiceSessionContextFor(
      user,
      'm1',
      {memoryTool: true},
      build,
    );
    const resumed = await voiceSessionContextFor(
      user,
      'm1',
      {memoryTool: true, resuming: true},
      build,
    );

    expect(build).toHaveBeenCalledTimes(1);
    expect(first.reused).toBe(false);
    expect(resumed).toEqual({...first, reused: true});
  });

  it('a new call always builds afresh', async () => {
    const build = builder();
    await voiceSessionContextFor(user, 'm1', {}, build);
    const next = await voiceSessionContextFor(user, 'm1', {}, build);

    expect(build).toHaveBeenCalledTimes(2);
    expect(next.systemInstruction).toBe('context 2');
  });

  it('builds when a reconnect finds nothing stored', async () => {
    const build = builder();
    const resumed = await voiceSessionContextFor(
      user,
      'm1',
      {resuming: true},
      build,
    );

    expect(build).toHaveBeenCalledTimes(1);
    expect(resumed.reused).toBe(false);
  });

  it('never reuses across conversations, abilities or time zones', () => {
    const base = voiceContextKey('u1', 'm1', {
      memoryTool: true,
      timeZone: 'Africa/Lagos',
    });
    expect(
      voiceContextKey('u1', 'm2', {memoryTool: true, timeZone: 'Africa/Lagos'}),
    ).not.toBe(base);
    expect(voiceContextKey('u1', 'm1', {timeZone: 'Africa/Lagos'})).not.toBe(
      base,
    );
    expect(
      voiceContextKey('u1', 'm1', {
        memoryTool: true,
        timeZone: 'Europe/London',
      }),
    ).not.toBe(base);
    expect(
      voiceContextKey('u2', 'm1', {memoryTool: true, timeZone: 'Africa/Lagos'}),
    ).not.toBe(base);
  });
});
