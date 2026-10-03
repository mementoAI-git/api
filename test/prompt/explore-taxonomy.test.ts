import assert from 'node:assert/strict';
import {test} from 'vitest';
import {
  EXPLORE_CATEGORIES,
  LEGACY_EXPLORE_CATEGORY_ALIASES,
  resolveExploreCategorySlug,
} from '../../src/module/api/prompt/explore-taxonomy';

void test('defines the approved Explore taxonomy in display order', () => {
  assert.deepEqual(
    EXPLORE_CATEGORIES.map(category => category.slug),
    [
      'growing-up',
      'people-i-love',
      'the-life-i-live',
      'things-i-love',
      'who-i-am',
      'work-purpose',
      'beliefs-faith',
      'where-i-come-from',
      'stories-adventures',
      'what-life-taught-me',
      'whats-ahead',
    ],
  );
  assert.equal(
    new Set(EXPLORE_CATEGORIES.map(category => category.slug)).size,
    11,
  );
});

void test('resolves every legacy category through the compatibility map', () => {
  assert.deepEqual(LEGACY_EXPLORE_CATEGORY_ALIASES, {
    career: 'work-purpose',
    family: 'people-i-love',
    relationship: 'people-i-love',
    region: 'beliefs-faith',
    belief: 'beliefs-faith',
    purpose: 'work-purpose',
    'life-transition': 'what-life-taught-me',
    wellbeing: 'the-life-i-live',
    identity: 'who-i-am',
    'experience-culture': 'stories-adventures',
  });
  assert.equal(resolveExploreCategorySlug('identity'), 'who-i-am');
  assert.equal(resolveExploreCategorySlug('growing-up'), 'growing-up');
  assert.equal(resolveExploreCategorySlug('unknown'), null);
});
