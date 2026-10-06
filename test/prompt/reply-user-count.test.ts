import assert from 'node:assert/strict';
import {mock} from 'node:test';
import {test, afterEach} from 'vitest';
afterEach(() => mock.restoreAll());
import Memory from '../../src/module/database/model/memory';
import {
  aiPromptReplyPattern,
  getPromptReplyUserCount,
} from '../../src/module/api/prompt/reply-user-count';

void test('static counts use only submitted replies and group by user, not by memory or date', async () => {
  const aggregate = mock.method(Memory, 'aggregate', async () => [{count: 42}]);
  assert.equal(await getPromptReplyUserCount({prompt_id: 'prompt-1'}), 42);
  const pipeline = aggregate.mock.calls[0].arguments[0];
  assert.deepEqual(pipeline, [
    {
      $match: {
        prompt: 'prompt-1',
        status: {$nin: ['draft', 'deleted']},
        user: {$type: 'string', $ne: ''},
      },
    },
    {$group: {_id: '$user'}},
    {$count: 'count'},
  ]);
});

void test('AI counts are scoped to the complete AI question without a day or user restriction', async () => {
  const aggregate = mock.method(Memory, 'aggregate', async () => [{count: 7}]);
  assert.equal(
    await getPromptReplyUserCount({prompt_text: 'What brings you joy?'}),
    7,
  );
  const pipeline = aggregate.mock.calls[0].arguments[0];
  const firstStage = pipeline[0];
  assert.ok('$match' in firstStage);
  assert.equal(firstStage.$match.prompt_type, 'ai-generated');
  const pattern = firstStage.$match.prompt_text as RegExp;
  assert.ok(pattern.test('  WHAT brings\n you joy?  '));
  assert.equal(pattern.test('What brings you joy? And why?'), false);
  assert.equal('reflection_day_key' in firstStage.$match, false);
  assert.deepEqual(pipeline[1], {$group: {_id: '$user'}});
});

void test('returns zero, without a synthetic floor, when there are no respondents', async () => {
  mock.method(Memory, 'aggregate', async () => []);
  assert.equal(await getPromptReplyUserCount({prompt_id: 'empty'}), 0);
});

void test('does not query for missing prompt identities', async () => {
  const aggregate = mock.method(Memory, 'aggregate', async () => []);
  assert.equal(await getPromptReplyUserCount({prompt_id: ''}), 0);
  assert.equal(await getPromptReplyUserCount({prompt_text: '   '}), 0);
  assert.equal(aggregate.mock.callCount(), 0);
});

void test('AI prompt matching escapes regex punctuation and ignores only case/whitespace', () => {
  const pattern = aiPromptReplyPattern('What does C++ (or $5) mean to you?');
  assert.ok(pattern.test('what does C++ (or $5) mean to you?'));
  assert.equal(pattern.test('What does CCC or 5 mean to you'), false);
});
