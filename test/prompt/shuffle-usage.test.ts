import assert from 'node:assert/strict';
import {mock} from 'node:test';
import {test, afterEach} from 'vitest';
afterEach(() => mock.restoreAll());
import Usage from '../../src/module/database/model/prompt-shuffle-usage';
import {
  consumeShuffle,
  getShuffleUsage,
  shuffleDay,
} from '../../src/module/api/prompt/shuffle-usage';

void test('shuffle days are account-scoped and reset at midnight UTC', () => {
  const before = shuffleDay('user-a', new Date('2026-10-06T23:59:59Z'));
  const after = shuffleDay('user-a', new Date('2026-10-07T00:00:00Z'));
  assert.notEqual(before.key, after.key);
  assert.equal(before.resetsAt.toISOString(), '2026-10-07T00:00:00.000Z');
  assert.notEqual(
    before.key,
    shuffleDay('user-b', new Date('2026-10-06T23:59:59Z')).key,
  );
});

void test('persists two uses, denies a third, and separates users and days', async () => {
  const counts = new Map<string, number>();
  mock.method(Usage, 'findById', (key: string) => ({
    lean: async () => (counts.has(key) ? {used: counts.get(key)} : null),
  }));
  mock.method(Usage, 'findOneAndUpdate', (filter, update, options) => ({
    lean: async () => {
      assert.deepEqual(filter.used, {$lt: 2});
      assert.deepEqual(update.$inc, {used: 1});
      assert.equal(options.upsert, true);
      const used = counts.get(filter._id) ?? 0;
      if (used >= 2)
        throw Object.assign(new Error('duplicate key'), {code: 11000});
      counts.set(filter._id, used + 1);
      return {used: used + 1};
    },
  }));
  const now = new Date('2026-10-06T12:00:00Z');
  const outcomes = await Promise.all(
    Array.from({length: 3}, () => consumeShuffle('a', now)),
  );
  assert.equal(outcomes.filter(result => result.allowed).length, 2);
  assert.equal((await getShuffleUsage('a', now)).remaining, 0);
  assert.equal((await consumeShuffle('b', now)).remaining, 1);
  assert.equal(
    (await consumeShuffle('a', new Date('2026-10-07T00:00:00Z'))).remaining,
    1,
  );
});

void test('storage failures do not grant a shuffle', async () => {
  mock.method(Usage, 'findOneAndUpdate', () => ({
    lean: async () => {
      throw new Error('offline');
    },
  }));
  await assert.rejects(consumeShuffle('a'), /offline/);
});
