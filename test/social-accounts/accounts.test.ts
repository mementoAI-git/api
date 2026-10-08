import assert from 'node:assert/strict';
import {test, mock} from '../helpers/legacy-test';
import {
  normalizeSocialProfileUrl,
  parseSocialAccountUpdate,
  confirmedSocialCandidates,
} from '../../src/utils/social-accounts';
import Persona from '../../src/module/database/model/persona';
import {saveConfirmedSocialAccounts} from '../../src/workers/insight/social-accounts';

void test('normalizes all five supported platform profiles', () => {
  for (const [platform, raw, expected] of [
    [
      'bluesky',
      'https://bsky.app/profile/me.bsky.social',
      'https://bsky.app/profile/me.bsky.social',
    ],
    ['x', 'https://twitter.com/memento?ref=test', 'https://x.com/memento'],
    [
      'youtube',
      'https://youtube.com/@memento',
      'https://www.youtube.com/@memento',
    ],
    [
      'linkedin',
      'https://linkedin.com/in/memento/',
      'https://www.linkedin.com/in/memento',
    ],
    [
      'facebook',
      'https://web.facebook.com/profile.php?id=123',
      'https://www.facebook.com/profile.php?id=123',
    ],
  ])
    assert.equal(normalizeSocialProfileUrl(platform as 'x', raw), expected);
});
void test('rejects unsafe schemes, lookalikes, redirects, posts and mismatched hosts', () => {
  for (const raw of [
    'javascript:alert(1)',
    'http://x.com/me',
    'https://x.com.evil.test/me',
    'https://x.com@evil.test/me',
    'https://x.com/me/status/123',
    'https://x.com/intent',
    'https://x.com:444/me',
    'https://x.com/%6de',
    'https://linkedin.com/in/me',
  ])
    assert.equal(normalizeSocialProfileUrl('x', raw), null);
  assert.equal(
    normalizeSocialProfileUrl('youtube', 'https://youtube.com/watch?v=123'),
    null,
  );
  assert.equal(
    normalizeSocialProfileUrl('facebook', 'https://facebook.com/groups'),
    null,
  );
});
void test('rejects Facebook redirect routes and generic profile pages', () => {
  for (const path of ['l.php', 'profile.php', 'photo.php', 'sharer.php'])
    assert.equal(
      normalizeSocialProfileUrl('facebook', `https://facebook.com/${path}`),
      null,
    );
});
void test('handle evidence must identify the matching platform', () => {
  const evidence = 'My Facebook handle is @memento.';
  assert.equal(
    confirmedSocialCandidates(
      [
        {
          platform: 'x',
          url: 'https://x.com/memento',
          ownership_confirmed: true,
          evidence,
        },
      ],
      evidence,
    ).length,
    0,
  );
});
void test('manual updates cannot forge AI metadata and null records removal', () => {
  assert.deepEqual(
    parseSocialAccountUpdate({
      x: 'https://twitter.com/memento',
      facebook: null,
    }),
    {x: 'https://x.com/memento', facebook: null},
  );
  assert.equal(
    parseSocialAccountUpdate({instagram: 'https://instagram.com/me'}),
    null,
  );
  assert.equal(
    parseSocialAccountUpdate({x: {url: 'https://x.com/me', source: 'ai'}}),
    null,
  );
});
const evidence = 'My official X account is https://x.com/memento.';
const candidate = {
  platform: 'x',
  url: 'https://x.com/memento',
  ownership_confirmed: true,
  evidence,
};
void test('only accepts explicit, grounded user ownership evidence', () => {
  assert.equal(confirmedSocialCandidates([candidate], evidence).length, 1);
  assert.equal(
    confirmedSocialCandidates([candidate], 'The AI says it belongs to me.')
      .length,
    0,
  );
  assert.equal(
    confirmedSocialCandidates(
      [{...candidate, ownership_confirmed: false}],
      evidence,
    ).length,
    0,
  );
  for (const quote of [
    'Look at https://x.com/memento.',
    'My friend owns https://x.com/memento.',
    'That account is not mine: https://x.com/memento.',
  ])
    assert.equal(
      confirmedSocialCandidates([{...candidate, evidence: quote}], quote)
        .length,
      0,
    );
  const handleEvidence = 'My X handle is @memento.';
  assert.equal(
    confirmedSocialCandidates(
      [{...candidate, evidence: handleEvidence}],
      handleEvidence,
    ).length,
    1,
  );
  assert.equal(
    confirmedSocialCandidates(
      [{...candidate, url: 'https://x.com/invented'}],
      evidence,
    ).length,
    0,
  );
});
void test('worker uses user-scoped atomic writes that preserve manual links and removals', async () => {
  const writes: unknown[][] = [];
  const update = mock.method(
    Persona,
    'updateOne',
    async (...args: unknown[]) => {
      writes.push(args);
      return {matchedCount: 1};
    },
  );
  try {
    await saveConfirmedSocialAccounts(
      'owner',
      'story-1',
      [candidate],
      evidence,
    );
    assert.equal(writes.length, 2);
    assert.deepEqual(writes[1][0], {
      user: 'owner',
      'social_accounts.x': {$exists: false},
    });
    const account = (
      writes[1][1] as {
        $set: Record<
          string,
          {source: string; source_id: string; evidence: string}
        >;
      }
    ).$set['social_accounts.x'];
    assert.equal(account.source, 'ai');
    assert.equal(account.source_id, 'story-1');
    assert.equal(account.evidence, evidence);
    writes.length = 0;
    await saveConfirmedSocialAccounts(
      'owner',
      'story-1',
      [candidate],
      'unrelated content',
    );
    assert.equal(writes.length, 0);
  } finally {
    update.mock.restore();
  }
});
