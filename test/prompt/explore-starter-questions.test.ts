import assert from 'node:assert/strict';
import {test} from 'vitest';
import {EXPLORE_CATEGORIES} from '../../src/module/api/prompt/explore-taxonomy';
import {EXPLORE_STARTER_QUESTIONS} from '../../src/module/api/prompt/explore-starter-questions';

function normalizeQuestion(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

void test('contains exactly ten unique starters for every Explore category', () => {
  assert.equal(EXPLORE_STARTER_QUESTIONS.length, 110);
  for (const category of EXPLORE_CATEGORIES) {
    assert.equal(
      EXPLORE_STARTER_QUESTIONS.filter(
        question => question.category === category.slug,
      ).length,
      10,
      category.slug,
    );
  }
  assert.equal(
    new Set(EXPLORE_STARTER_QUESTIONS.map(question => question.stable_id)).size,
    110,
  );
  assert.equal(
    new Set(
      EXPLORE_STARTER_QUESTIONS.map(question =>
        normalizeQuestion(question.title),
      ),
    ).size,
    110,
  );
});

void test('uses deterministic stable ids and starter metadata', () => {
  for (const category of EXPLORE_CATEGORIES) {
    const questions = EXPLORE_STARTER_QUESTIONS.filter(
      question => question.category === category.slug,
    );
    assert.deepEqual(
      questions.map(question => question.stable_id),
      Array.from(
        {length: 10},
        (_, index) =>
          `starter:${category.slug}:${String(index + 1).padStart(2, '0')}`,
      ),
    );
    assert.ok(questions.every(question => question.source === 'starter'));
    assert.ok(questions.every(question => question.active));
  }
});
