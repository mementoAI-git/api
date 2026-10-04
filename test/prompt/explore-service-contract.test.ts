import assert from 'node:assert/strict';
import {test} from 'vitest';
import {
  buildExplorePromptScope,
  buildExploreSuggestionScope,
  buildPromptOwnershipScope,
  isExploreQuestionFeedbackStatus,
  withExploreCategoryTitle,
} from '../../src/module/api/prompt/explore-contract';

void test('scopes generated questions to their owner while retaining global questions', () => {
  assert.deepEqual(buildExplorePromptScope('who-i-am', 'user-1'), {
    category: 'who-i-am',
    $or: [
      {source: {$in: ['starter', 'legacy']}},
      {source: {$exists: false}},
      {source: 'ai-generated', owner_user: 'user-1'},
    ],
  });
});

void test('excludes suppressed prompt ids using database ids for suggestion queries', () => {
  const hiddenId = '507f1f77bcf86cd799439011';
  const scope = buildExploreSuggestionScope('user-1', [hiddenId]);
  assert.equal(scope._id.$nin[0].toHexString(), hiddenId);
});

void test('returns readable category names for canonical and legacy suggestion slugs', () => {
  assert.equal(
    withExploreCategoryTitle({category: 'work-purpose', title: 'A question?'})
      .category_title,
    'Work & Purpose',
  );
  const legacy = withExploreCategoryTitle({category: 'region'});
  assert.equal(legacy.category, 'beliefs-faith');
  assert.equal(legacy.category_title, 'Beliefs & Faith');
  assert.equal(
    withExploreCategoryTitle({category: 'unknown'}).category_title,
    'Question',
  );
});

void test('allows global prompts and only the current user personalized prompts', () => {
  assert.deepEqual(buildPromptOwnershipScope('user-1'), {
    $or: [
      {owner_user: {$exists: false}},
      {owner_user: null},
      {owner_user: 'user-1'},
    ],
  });
});

void test('limits suggestions to active starters and the current user personalized pool', () => {
  assert.deepEqual(buildExploreSuggestionScope('user-1'), {
    _id: {$nin: []},
    active: {$ne: false},
    $or: [{source: 'starter'}, {source: 'ai-generated', owner_user: 'user-1'}],
  });
});

void test('accepts only distinct skip and not-relevant feedback statuses', () => {
  assert.equal(isExploreQuestionFeedbackStatus('skipped'), true);
  assert.equal(isExploreQuestionFeedbackStatus('not-relevant'), true);
  assert.equal(isExploreQuestionFeedbackStatus('answered'), false);
  assert.equal(isExploreQuestionFeedbackStatus(''), false);
});
