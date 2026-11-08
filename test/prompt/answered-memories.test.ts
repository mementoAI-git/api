import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'vitest';
import {
  hasAnswerText,
  liveAnswerFilter,
  memoryHasAnswer,
} from '../../src/module/api/prompt/answered-memories';

void test('only readable text counts as an answer body', () => {
  assert.equal(hasAnswerText('<p>I laugh loudly.</p>'), true);
  assert.equal(hasAnswerText('<p></p><p>&nbsp;</p>'), false);
  assert.equal(hasAnswerText(''), false);
  assert.equal(hasAnswerText(undefined), false);
});

void test('a memory is answered by body text, attachments or a host message', () => {
  const none = new Set<string>();
  assert.equal(memoryHasAnswer({_id: 'a', body: '<p>Yes</p>'}, none), true);
  assert.equal(
    memoryHasAnswer({_id: 'b', body: '', attachments: ['file-1']}, none),
    true,
  );
  assert.equal(memoryHasAnswer({_id: 'c', body: ''}, new Set(['c'])), true);
  // An empty conversation shell (opened, never replied to) is not an answer.
  assert.equal(
    memoryHasAnswer({_id: 'd', body: '', attachments: []}, none),
    false,
  );
});

void test('drafts, deleted and purge-pending memories never count', () => {
  assert.deepEqual(liveAnswerFilter('user-1'), {
    user: 'user-1',
    status: {$nin: ['draft', 'deleted']},
    purge_requested_at: null,
  });
});

void test('answered tab, daily prompts and topic lookup share the answer rule', () => {
  const service = readFileSync('src/module/api/prompt/service.ts', 'utf8');
  const personalization = readFileSync(
    'src/module/api/prompt/explore-personalization.ts',
    'utf8',
  );
  assert.match(service, /from '\.\/answered-memories'/);
  assert.match(service, /findAnsweredPromptMemoryId\(user_id, id\)/);
  assert.doesNotMatch(service, /const getAnsweredPromptIds = async/);
  assert.match(personalization, /getAnsweredPromptIds\(userId\)/);
});
