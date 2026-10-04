import assert from 'node:assert/strict';
import {test} from 'vitest';
import Prompt from '../../src/module/database/model/prompt';
import ExploreQuestionState from '../../src/module/database/model/explore-question-state';

void test('Prompt exposes additive Explore metadata', () => {
  for (const path of [
    'stable_id',
    'source',
    'legacy_category',
    'owner_user',
    'active',
    'generation_context',
  ]) {
    assert.ok(Prompt.schema.path(path), path);
  }
  assert.deepEqual(
    (Prompt.schema.path('source') as {options?: {enum?: string[]}}).options
      ?.enum,
    ['starter', 'ai-generated', 'legacy'],
  );
});

void test('question state supports distinct skip and not-relevant feedback', () => {
  assert.deepEqual(
    (
      ExploreQuestionState.schema.path('status') as {
        options?: {enum?: string[]};
      }
    ).options?.enum,
    ['skipped', 'not-relevant'],
  );
  const uniqueIndex = ExploreQuestionState.schema
    .indexes()
    .find(
      ([fields, options]) =>
        fields.user === 1 && fields.prompt === 1 && options.unique,
    );
  assert.ok(uniqueIndex);
});
