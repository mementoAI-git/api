import assert from 'node:assert/strict';
import {it as test} from 'vitest';
import {
  ReferralTracker,
  ReferralRepository,
} from '../../src/services/referrals';

function fixture() {
  let stored: string | null = null;
  let lookups = 0;
  const repository: ReferralRepository = {
    async getCode() {
      return stored;
    },
    async ensureCode(_id, code) {
      stored ||= code;
      return stored;
    },
    async findInviter(code) {
      lookups++;
      return code === stored ? 'inviter-1' : undefined;
    },
    async countSignups(id) {
      assert.equal(id, 'inviter-1');
      return 3;
    },
  };
  return {tracker: new ReferralTracker(repository), lookups: () => lookups};
}
void test('personal links are stable, persisted and report unique signup count', async () => {
  const {tracker} = fixture();
  const first = await tracker.summary('inviter-1', 'https://mymemento.io');
  const second = await tracker.summary('inviter-1', 'https://mymemento.io');
  assert.deepEqual(first, second);
  assert.equal(first.signup_count, 3);
  const url = new URL(first.invite_url);
  assert.equal(url.pathname, '/register');
  assert.match(url.searchParams.get('ref')!, /^[a-f0-9]{32}$/);
  assert.equal(await tracker.inviter(url.searchParams.get('ref')), 'inviter-1');
});
void test('invalid codes cannot become query objects and unknown codes do not attribute', async () => {
  const {tracker, lookups} = fixture();
  for (const value of [
    undefined,
    '',
    {$ne: null},
    'not-a-code',
    'a'.repeat(33),
  ])
    assert.equal(await tracker.inviter(value), undefined);
  assert.equal(lookups(), 0);
  assert.equal(await tracker.inviter('a'.repeat(32)), undefined);
});
void test('concurrent first requests return one persisted link', async () => {
  const {tracker} = fixture();
  const values = await Promise.all(
    Array.from({length: 10}, () =>
      tracker.summary('inviter-1', 'https://mymemento.io'),
    ),
  );
  assert.equal(new Set(values.map(value => value.invite_url)).size, 1);
});
