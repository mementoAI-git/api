import assert from 'node:assert/strict';
import {test} from 'vitest';
import {
  computeExploreProgress,
  dedupeQuestions,
  isExploreQuestionSuppressed,
  questionSimilarity,
  resolveExploreMix,
  selectExploreQuestions,
} from '../../src/module/api/prompt/explore-selection';

const starter = (id: string, title = `Starter ${id}`) => ({
  _id: id,
  title,
  source: 'starter' as const,
});
const personalized = (id: string, title = `Personalized ${id}`) => ({
  _id: id,
  title,
  source: 'ai-generated' as const,
});

void test('enables personalization after five starter answers', () => {
  assert.equal(computeExploreProgress(4).personalizedQuestionsEnabled, false);
  assert.equal(computeExploreProgress(5).personalizedQuestionsEnabled, true);
  assert.equal(computeExploreProgress(5).starterTotal, 10);
});

void test('treats skip as a cooldown and not-relevant as permanent suppression', () => {
  const now = new Date('2026-10-03T12:00:00.000Z');
  assert.equal(
    isExploreQuestionSuppressed(
      'skipped',
      new Date('2026-10-03T11:00:00.000Z'),
      now,
    ),
    true,
  );
  assert.equal(
    isExploreQuestionSuppressed(
      'skipped',
      new Date('2026-10-01T11:00:00.000Z'),
      now,
    ),
    false,
  );
  assert.equal(
    isExploreQuestionSuppressed(
      'not-relevant',
      new Date('2025-01-01T00:00:00.000Z'),
      now,
    ),
    true,
  );
});

void test('uses starter-only, standard, and high-context mix targets', () => {
  assert.deepEqual(resolveExploreMix(4, 20, 10), {
    starter: 10,
    personalized: 0,
  });
  assert.deepEqual(resolveExploreMix(5, 4, 10), {starter: 6, personalized: 4});
  assert.deepEqual(resolveExploreMix(8, 5, 10), {starter: 3, personalized: 7});
});

void test('backfills from the available pool and excludes answered or suppressed ids', () => {
  const result = selectExploreQuestions({
    starterQuestions: Array.from({length: 10}, (_, index) =>
      starter(`s${index}`),
    ),
    personalizedQuestions: [personalized('p1'), personalized('p2')],
    answeredIds: new Set(['s0']),
    suppressedIds: new Set(['s1']),
    starterAnswered: 5,
    usableContextCount: 2,
    limit: 10,
  });
  assert.equal(result.length, 10);
  assert.equal(
    result.filter(question => question.source === 'ai-generated').length,
    2,
  );
  assert.ok(result.every(question => !['s0', 's1'].includes(question._id)));
});

void test('interleaves personalized questions into the first visible page', () => {
  const result = selectExploreQuestions({
    starterQuestions: Array.from({length: 12}, (_, index) =>
      starter(`s${index}`),
    ),
    personalizedQuestions: Array.from({length: 8}, (_, index) =>
      personalized(`p${index}`),
    ),
    answeredIds: new Set(),
    suppressedIds: new Set(),
    starterAnswered: 5,
    usableContextCount: 2,
    limit: 20,
  });

  assert.equal(
    result.slice(0, 10).filter(question => question.source === 'ai-generated')
      .length,
    4,
  );
});

void test('removes exact and near-duplicate questions', () => {
  assert.ok(
    questionSimilarity(
      'What kind of work makes you feel proud?',
      'What work makes you feel proud of yourself?',
    ) >= 0.7,
  );
  const result = dedupeQuestions([
    starter('1', 'What kind of work makes you feel proud?'),
    personalized('2', '  what KIND of work makes you feel proud? '),
    personalized('3', 'What work makes you feel proud of yourself?'),
    starter('4', 'Who can usually make you laugh?'),
  ]);
  assert.deepEqual(
    result.map(question => question._id),
    ['1', '4'],
  );
});
