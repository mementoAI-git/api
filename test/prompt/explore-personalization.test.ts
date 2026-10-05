import assert from 'node:assert/strict';
import {test} from 'vitest';
import {
  EXPLORE_PERSONALIZATION_SYSTEM_INSTRUCTION,
  buildExplorePersonalizationUserPrompt,
} from '../../src/module/api/prompt/explore-personalization';

void test('prohibits unsupported sensitive assumptions and hidden reasoning', () => {
  for (const term of [
    'marriage',
    'children',
    'heartbreak',
    'bereavement',
    'trauma',
    'religion',
    'travel',
    'career success',
    'job loss',
    'illness',
    'major life transitions',
  ]) {
    assert.match(
      EXPLORE_PERSONALIZATION_SYSTEM_INSTRUCTION.toLowerCase(),
      new RegExp(term),
    );
  }
  assert.match(
    EXPLORE_PERSONALIZATION_SYSTEM_INSTRUCTION,
    /exactly one question/i,
  );
  assert.match(EXPLORE_PERSONALIZATION_SYSTEM_INSTRUCTION, /plain text/i);
  assert.match(EXPLORE_PERSONALIZATION_SYSTEM_INSTRUCTION, /do not reveal/i);
});

void test('builds category-specific context and distinguishes negative feedback strength', () => {
  const prompt = buildExplorePersonalizationUserPrompt({
    categoryTitle: 'Who I Am',
    categoryDescription: 'Personality and identity.',
    sameCategoryAnswers: ['I feel most myself while drawing.'],
    otherContext: ['I have been learning animation.'],
    skippedQuestions: ['When do you feel confident?'],
    notRelevantQuestions: ['How has parenthood changed you?'],
    questionsToAvoid: ['What makes you creative?'],
  });
  assert.match(prompt, /Who I Am/);
  assert.match(prompt, /weak negative signal/i);
  assert.match(prompt, /strong negative signal/i);
  assert.match(prompt, /parenthood/i);
  assert.match(prompt, /drawing/i);
});
