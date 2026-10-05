import {Types} from 'mongoose';
import {
  EXPLORE_CATEGORIES,
  resolveExploreCategorySlug,
  type ExploreCategorySlug,
} from './explore-taxonomy';

export function buildExplorePromptScope(
  category: ExploreCategorySlug,
  userId: string,
) {
  return {
    category,
    $or: [
      {source: {$in: ['starter', 'legacy']}},
      {source: {$exists: false}},
      {source: 'ai-generated', owner_user: userId},
    ],
  };
}

export function buildExploreSuggestionScope(
  userId: string,
  excludedPromptIds: string[] = [],
) {
  return {
    // Aggregate queries do not cast string ids automatically.
    _id: {
      $nin: excludedPromptIds
        .filter(id => Types.ObjectId.isValid(id))
        .map(id => new Types.ObjectId(id)),
    },
    active: {$ne: false},
    $or: [{source: 'starter'}, {source: 'ai-generated', owner_user: userId}],
  };
}

export function withExploreCategoryTitle<T extends {category: string}>(
  prompt: T,
): T & {category_title: string} {
  const slug = resolveExploreCategorySlug(prompt.category);
  const category = EXPLORE_CATEGORIES.find(item => item.slug === slug);
  return {
    ...prompt,
    category: slug ?? prompt.category,
    category_title: category?.title ?? 'Question',
  };
}

export function buildPromptOwnershipScope(userId: string) {
  return {
    $or: [
      {owner_user: {$exists: false}},
      {owner_user: null},
      {owner_user: userId},
    ],
  };
}

export function isExploreQuestionFeedbackStatus(
  value: unknown,
): value is 'skipped' | 'not-relevant' {
  return value === 'skipped' || value === 'not-relevant';
}
