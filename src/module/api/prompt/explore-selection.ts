export const EXPLORE_PERSONALIZATION_THRESHOLD = 5;
export const EXPLORE_HIGH_CONTEXT_STARTER_THRESHOLD = 8;
export const EXPLORE_HIGH_CONTEXT_RECORD_THRESHOLD = 5;
export const EXPLORE_STARTER_TOTAL = 10;
export const EXPLORE_NEAR_DUPLICATE_THRESHOLD = 0.7;
export const EXPLORE_SKIP_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export interface ExploreQuestionCandidate {
  _id: string;
  title: string;
  source: 'starter' | 'ai-generated' | 'legacy';
  [key: string]: unknown;
}

export function isExploreQuestionSuppressed(
  status: 'skipped' | 'not-relevant',
  updatedAt?: Date | string,
  now = new Date(),
): boolean {
  if (status === 'not-relevant') return true;
  if (!updatedAt) return true;
  const updatedAtMs = new Date(updatedAt).getTime();
  if (!Number.isFinite(updatedAtMs)) return true;
  return now.getTime() - updatedAtMs < EXPLORE_SKIP_COOLDOWN_MS;
}

export function computeExploreProgress(starterAnswered: number) {
  const answered = Math.max(
    0,
    Math.min(EXPLORE_STARTER_TOTAL, starterAnswered),
  );
  return {
    starterAnswered: answered,
    starterTotal: EXPLORE_STARTER_TOTAL,
    personalizedQuestionsEnabled: answered >= EXPLORE_PERSONALIZATION_THRESHOLD,
  };
}

export function resolveExploreMix(
  starterAnswered: number,
  usableContextCount: number,
  limit: number,
) {
  const size = Math.max(0, Math.floor(limit));
  if (starterAnswered < EXPLORE_PERSONALIZATION_THRESHOLD) {
    return {starter: size, personalized: 0};
  }
  const personalizedRatio =
    starterAnswered >= EXPLORE_HIGH_CONTEXT_STARTER_THRESHOLD &&
    usableContextCount >= EXPLORE_HIGH_CONTEXT_RECORD_THRESHOLD
      ? 0.7
      : 0.4;
  const personalized = Math.round(size * personalizedRatio);
  return {starter: size - personalized, personalized};
}

export function normalizeQuestion(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const SIMILARITY_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'do',
  'does',
  'for',
  'is',
  'kind',
  'of',
  'the',
  'to',
  'what',
  'you',
  'your',
  'yourself',
]);

function questionTokens(value: string): Set<string> {
  return new Set(
    normalizeQuestion(value)
      .split(' ')
      .filter(token => token && !SIMILARITY_STOP_WORDS.has(token)),
  );
}

export function questionSimilarity(left: string, right: string): number {
  const normalizedLeft = normalizeQuestion(left);
  const normalizedRight = normalizeQuestion(right);
  if (!normalizedLeft || !normalizedRight) return 0;
  if (normalizedLeft === normalizedRight) return 1;

  const leftTokens = questionTokens(left);
  const rightTokens = questionTokens(right);
  const union = new Set([...leftTokens, ...rightTokens]);
  if (union.size === 0) return 0;
  const intersection = [...leftTokens].filter(token => rightTokens.has(token));
  return intersection.length / union.size;
}

export function dedupeQuestions(
  questions: ExploreQuestionCandidate[],
): ExploreQuestionCandidate[] {
  const selected: ExploreQuestionCandidate[] = [];
  for (const question of questions) {
    const duplicate = selected.some(
      existing =>
        questionSimilarity(existing.title, question.title) >=
        EXPLORE_NEAR_DUPLICATE_THRESHOLD,
    );
    if (!duplicate) selected.push(question);
  }
  return selected;
}

function interleaveQuestionSources(
  starterQuestions: ExploreQuestionCandidate[],
  personalizedQuestions: ExploreQuestionCandidate[],
): ExploreQuestionCandidate[] {
  const result: ExploreQuestionCandidate[] = [];
  const total = starterQuestions.length + personalizedQuestions.length;
  let starterIndex = 0;
  let personalizedIndex = 0;

  for (let index = 0; index < total; index += 1) {
    const desiredPersonalizedCount = Math.round(
      ((index + 1) * personalizedQuestions.length) / total,
    );
    const shouldUsePersonalized =
      personalizedIndex < desiredPersonalizedCount &&
      personalizedIndex < personalizedQuestions.length;

    if (shouldUsePersonalized || starterIndex >= starterQuestions.length) {
      result.push(personalizedQuestions[personalizedIndex]);
      personalizedIndex += 1;
    } else {
      result.push(starterQuestions[starterIndex]);
      starterIndex += 1;
    }
  }

  return result;
}

export function selectExploreQuestions(input: {
  starterQuestions: ExploreQuestionCandidate[];
  personalizedQuestions: ExploreQuestionCandidate[];
  answeredIds: Set<string>;
  suppressedIds: Set<string>;
  starterAnswered: number;
  usableContextCount: number;
  limit: number;
}): ExploreQuestionCandidate[] {
  const {starter, personalized} = resolveExploreMix(
    input.starterAnswered,
    input.usableContextCount,
    input.limit,
  );
  const eligible = (question: ExploreQuestionCandidate) =>
    !input.answeredIds.has(question._id) &&
    !input.suppressedIds.has(question._id);
  const all = dedupeQuestions([
    ...input.starterQuestions.filter(eligible),
    ...input.personalizedQuestions.filter(eligible),
  ]);
  const starters = all.filter(question => question.source === 'starter');
  const personalizedQuestions = all.filter(
    question => question.source === 'ai-generated',
  );
  const selected = [
    ...starters.slice(0, starter),
    ...personalizedQuestions.slice(0, personalized),
  ];
  if (selected.length < input.limit) {
    const selectedIds = new Set(selected.map(question => question._id));
    selected.push(
      ...all
        .filter(question => !selectedIds.has(question._id))
        .slice(0, input.limit - selected.length),
    );
  }
  return interleaveQuestionSources(
    selected.filter(question => question.source === 'starter'),
    selected.filter(question => question.source === 'ai-generated'),
  ).slice(0, input.limit);
}
