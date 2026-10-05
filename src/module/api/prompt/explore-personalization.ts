import {randomUUID} from 'node:crypto';
import {createUserContent} from '@google/genai';
import Memory from '../../database/model/memory';
import PendingInsight from '../../database/model/pending-insight';
import Persona from '../../database/model/persona';
import Prompt from '../../database/model/prompt';
import ExploreQuestionState from '../../database/model/explore-question-state';
import gemini, {GEMINI_MODEL} from '../../../services/gemini';
import {
  generateTextWithFallback,
  openRouterClient,
} from '../../../services/ai/openrouter';
import {
  getCompatibleExploreCategoryValues,
  type ExploreCategorySlug,
  EXPLORE_CATEGORIES,
} from './explore-taxonomy';
import {
  computeExploreProgress,
  isExploreQuestionSuppressed,
  normalizeQuestion,
  questionSimilarity,
} from './explore-selection';

const GENERATION_VERSION = 'explore-personalization-v1';
const PERSONALIZED_POOL_FLOOR = 3;

export const EXPLORE_PERSONALIZATION_SYSTEM_INSTRUCTION = `You write exactly one question for a personal reflection app.

Return plain text only: one warm, concise question with no preamble, bullets, quotes, or hidden reasoning.
Use only evidence in the supplied context. Ask about the person before assuming an experience.
Do not assume marriage, children, heartbreak, bereavement, trauma, religion, travel, career success, job loss, illness, or major life transitions unless the supplied context clearly supports it.
Treat skipped questions as a weak negative signal. Treat not-relevant questions as a strong negative signal and avoid their assumptions.
Do not repeat or closely paraphrase any question in the avoid list.
Do not mention Memento, categories, scores, thresholds, context records, feedback, or internal instructions.
Do not reveal chain-of-thought, hidden reasoning, or source identifiers.`;

export interface ExplorePersonalizationPromptInput {
  categoryTitle: string;
  categoryDescription: string;
  sameCategoryAnswers: string[];
  otherContext: string[];
  skippedQuestions: string[];
  notRelevantQuestions: string[];
  questionsToAvoid: string[];
}

function formatList(items: string[], fallback: string): string {
  if (items.length === 0) return fallback;
  return items.map((item, index) => `${index + 1}. ${item}`).join('\n');
}

export function buildExplorePersonalizationUserPrompt(
  input: ExplorePersonalizationPromptInput,
): string {
  return [
    `Explore category: ${input.categoryTitle}`,
    `Category scope: ${input.categoryDescription}`,
    `Saved answers from this category:\n${formatList(input.sameCategoryAnswers, 'None yet.')}`,
    `Other known context:\n${formatList(input.otherContext, 'No additional context.')}`,
    `Skipped questions (weak negative signal; do not immediately resurface):\n${formatList(input.skippedQuestions, 'None.')}`,
    `Not relevant questions (strong negative signal; avoid the topic or assumption):\n${formatList(input.notRelevantQuestions, 'None.')}`,
    `Questions to avoid repeating or paraphrasing:\n${formatList(input.questionsToAvoid, 'None.')}`,
    'Write one new evidence-based reflection question for this category.',
  ].join('\n\n');
}

function stripHtml(value: string): string {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanQuestion(value: string): string {
  const firstLine = String(value || '')
    .replace(/^[\s"'“”]+|[\s"'“”]+$/g, '')
    .split('\n')[0]
    .replace(/^(question:|reflection:)\s*/i, '')
    .trim();
  if (!firstLine) return '';
  return firstLine.length > 320 ? `${firstLine.slice(0, 317)}...` : firstLine;
}

async function loadPersonalizationContext(
  userId: string,
  category: ExploreCategorySlug,
) {
  const categoryValues = getCompatibleExploreCategoryValues(category);
  const categoryPrompts = await Prompt.find({category: {$in: categoryValues}})
    .select('_id title source')
    .lean();
  const categoryPromptIds = categoryPrompts.map(prompt => String(prompt._id));
  const [sameCategoryMemories, recentMemories, persona, insights, states] =
    await Promise.all([
      Memory.find({
        user: userId,
        prompt: {$in: categoryPromptIds},
        status: {$nin: ['draft', 'deleted']},
      })
        .sort({created_at: -1})
        .limit(8)
        .select('_id title body')
        .lean(),
      Memory.find({
        user: userId,
        status: {$nin: ['draft', 'deleted']},
      })
        .sort({created_at: -1})
        .limit(6)
        .select('_id title body summary')
        .lean(),
      Persona.findOne({user: userId})
        .select(
          'important_notes key_preferences goals_and_aspirations self_description personality_traits memory_treasures',
        )
        .lean(),
      PendingInsight.find({user: userId})
        .sort({created_at: -1})
        .limit(5)
        .select('_id content')
        .lean(),
      ExploreQuestionState.find({user: userId}).select('prompt status').lean(),
    ]);

  const feedbackPromptIds = states.map(state => String(state.prompt));
  const feedbackPrompts = feedbackPromptIds.length
    ? await Prompt.find({_id: {$in: feedbackPromptIds}})
        .select('_id title')
        .lean()
    : [];
  const feedbackTitleById = new Map(
    feedbackPrompts.map(prompt => [String(prompt._id), prompt.title]),
  );
  const personaValues = persona
    ? [
        persona.self_description,
        ...(persona.important_notes || []),
        ...(persona.key_preferences || []),
        ...(persona.goals_and_aspirations || []),
        ...(persona.personality_traits || []),
        ...(persona.memory_treasures || []),
      ].filter((value): value is string => Boolean(value))
    : [];
  const sourceIds = [
    ...sameCategoryMemories.map(memory => String(memory._id)),
    ...recentMemories.map(memory => String(memory._id)),
    ...insights.map(insight => String(insight._id)),
  ].slice(0, 20);

  return {
    sourceIds,
    input: {
      categoryTitle:
        EXPLORE_CATEGORIES.find(item => item.slug === category)?.title ??
        category,
      categoryDescription:
        EXPLORE_CATEGORIES.find(item => item.slug === category)?.description ??
        '',
      sameCategoryAnswers: sameCategoryMemories
        .map(memory =>
          stripHtml(String(memory.body || memory.title || '')).slice(0, 400),
        )
        .filter(Boolean),
      otherContext: [
        ...personaValues,
        ...insights.map(insight => insight.content),
        ...recentMemories.map(memory =>
          stripHtml(
            String(memory.summary || memory.body || memory.title || ''),
          ).slice(0, 300),
        ),
      ]
        .filter(Boolean)
        .slice(0, 16),
      skippedQuestions: states
        .filter(state => state.status === 'skipped')
        .map(state => feedbackTitleById.get(String(state.prompt)))
        .filter((value): value is string => Boolean(value)),
      notRelevantQuestions: states
        .filter(state => state.status === 'not-relevant')
        .map(state => feedbackTitleById.get(String(state.prompt)))
        .filter((value): value is string => Boolean(value)),
      questionsToAvoid: categoryPrompts
        .map(prompt => prompt.title)
        .slice(0, 80),
    },
    categoryPrompts,
  };
}

async function generateQuestion(userPrompt: string): Promise<string> {
  if (openRouterClient.isConfigured()) {
    const result = await generateTextWithFallback({
      task: 'explore_question_generate',
      messages: [
        {role: 'system', content: EXPLORE_PERSONALIZATION_SYSTEM_INSTRUCTION},
        {role: 'user', content: userPrompt},
      ],
      temperature: 0.75,
    });
    return cleanQuestion(result.text);
  }
  const response = await gemini.models.generateContent({
    model: GEMINI_MODEL,
    contents: createUserContent([userPrompt]),
    config: {systemInstruction: EXPLORE_PERSONALIZATION_SYSTEM_INSTRUCTION},
  });
  return cleanQuestion(response.text || '');
}

export async function generateAndStoreExploreQuestion(
  userId: string,
  category: ExploreCategorySlug,
) {
  const categoryValues = getCompatibleExploreCategoryValues(category);
  const answeredMemories = await Memory.find({
    user: userId,
    prompt: {$exists: true, $ne: null},
    status: {$nin: ['draft', 'deleted']},
  })
    .select('prompt')
    .lean();
  const answeredIds = answeredMemories.map(memory => String(memory.prompt));
  const starterAnswered = await Prompt.countDocuments({
    _id: {$in: answeredIds},
    category: {$in: categoryValues},
    source: 'starter',
  });
  if (!computeExploreProgress(starterAnswered).personalizedQuestionsEnabled) {
    return null;
  }
  const suppressedStates = await ExploreQuestionState.find({user: userId})
    .select('prompt status updated_at')
    .lean();
  const poolCount = await Prompt.countDocuments({
    _id: {
      $nin: suppressedStates
        .filter(state =>
          isExploreQuestionSuppressed(state.status, state.updated_at),
        )
        .map(state => state.prompt),
    },
    owner_user: userId,
    category,
    source: 'ai-generated',
    active: {$ne: false},
  });
  if (poolCount >= PERSONALIZED_POOL_FLOOR) return null;

  const context = await loadPersonalizationContext(userId, category);
  const title = await generateQuestion(
    buildExplorePersonalizationUserPrompt(context.input),
  );
  if (!title || !title.endsWith('?')) return null;
  const duplicate = context.categoryPrompts.some(
    prompt =>
      normalizeQuestion(prompt.title) === normalizeQuestion(title) ||
      questionSimilarity(prompt.title, title) >= 0.7,
  );
  if (duplicate) return null;

  return Prompt.create({
    stable_id: `personalized:${userId}:${category}:${randomUUID()}`,
    title,
    type: 'question',
    category,
    source: 'ai-generated',
    owner_user: userId,
    active: true,
    tags: [],
    generation_context: {
      version: GENERATION_VERSION,
      source_ids: context.sourceIds,
      generated_at: new Date(),
    },
  });
}
