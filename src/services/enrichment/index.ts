import dayjs from 'dayjs';
import Memory from '../../module/database/model/memory';
import Persona from '../../module/database/model/persona';
import User from '../../module/database/model/user';
import redis from '../redis';
import {NotFoundException} from '../../utils/service-error';

// ---------------------------------------------------------------------------
// CANONICAL ENRICHMENT CATEGORIES (10 life dimensions)
// ---------------------------------------------------------------------------

export const ENRICHMENT_CATEGORIES = [
  'identity_self',
  'relationships_people',
  'work_purpose',
  'memories_experiences',
  'beliefs_worldview',
  'passions_interests',
  'heritage_roots',
  'lessons_wisdom',
  'hopes_legacy',
  'everyday_life',
] as const;

export type EnrichmentCategory = (typeof ENRICHMENT_CATEGORIES)[number];

// Deferred categories — unlocked after enough active usage
const DEFERRED_CATEGORIES: Record<string, number> = {
  lessons_wisdom: 14, // unlock after 2 weeks
  hopes_legacy: 21, // unlock after 3 weeks
};

// Decay settings
const DECAY_IDLE_DAYS = 14; // start decaying after 14 days idle
const DECAY_RATE_PER_WEEK = 2; // lose 2% per week per category
const SCORE_FLOOR = 5; // overall score never below 5%
const ACTIVITY_PAUSE_DAYS = 7; // any activity within 7 days fully pauses decay

// Redis cache
const ENRICHMENT_CACHE_TTL = 60 * 30; // 30 minutes
const enrichmentCacheKey = (userId: string) => `enrichment:score:${userId}`;

/** Call after any write that changes a user's enrichment (new memory, story save, etc.) */
export async function invalidateEnrichmentCache(userId: string): Promise<void> {
  await redis?.del(enrichmentCacheKey(userId));
}

// Weights for different content sources
const CONVERSATION_WEIGHT = 0.9; // AI-derived content weighted slightly lower
const EXPLICIT_WEIGHT = 1.0; // user-authored content full weight

// ---------------------------------------------------------------------------
// TYPES
// ---------------------------------------------------------------------------

export interface CategoryScore {
  key: EnrichmentCategory;
  label: string;
  score: number; // 0–100
  weight: number; // priority weight (from onboarding)
  itemCount: number; // how many items tagged to this category
  unlocked: boolean; // whether this category is active
}

export interface EnrichmentResult {
  enrichment_score: number; // 0–100 overall
  category_scores: CategoryScore[];
  lowest_category: string | null; // key of lowest non-deferred active category
  beneficiary_access_unlocked: boolean; // true if score ever reached 20%
}

// Friendly labels for each category (exported for prompts / tooling)
export const CATEGORY_LABELS: Record<EnrichmentCategory, string> = {
  identity_self: 'Identity & Self',
  relationships_people: 'Relationships & People',
  work_purpose: 'Work & Purpose',
  memories_experiences: 'Memories & Experiences',
  beliefs_worldview: 'Beliefs & Worldview',
  passions_interests: 'Passions & Interests',
  heritage_roots: 'Heritage & Roots',
  lessons_wisdom: 'Lessons & Wisdom',
  hopes_legacy: 'Hopes & Legacy',
  everyday_life: 'Everyday Life',
};

// Deep-dive nudge questions — one compelling question per category
export const CATEGORY_NUDGES: Record<EnrichmentCategory, string> = {
  identity_self:
    "What's something about yourself that most people don't know but you wish they did?",
  relationships_people:
    'Who has had the biggest influence on who you are today, and in what way?',
  work_purpose: 'What kind of work makes you lose track of time?',
  memories_experiences:
    "What's a moment from your past that you find yourself returning to often?",
  beliefs_worldview:
    "Is there a belief you hold now that you didn't have 10 years ago?",
  passions_interests:
    "What's something you're into that you rarely get to talk about?",
  heritage_roots:
    "What's something about where you come from that shaped who you are?",
  lessons_wisdom:
    "What's the hardest lesson you've had to learn — and what changed after you learned it?",
  hopes_legacy:
    'What do you want to still be true about your life 20 years from now?',
  everyday_life: 'What does a really good day look like for you?',
};

// Jump pill starters — short prompts to launch a themed conversation
export const CATEGORY_STARTERS: Record<EnrichmentCategory, string> = {
  identity_self: 'Tell me about who you are',
  relationships_people: 'Tell me about someone important to you',
  work_purpose: 'Tell me about your work',
  memories_experiences: 'Share a memory that matters',
  beliefs_worldview: 'Tell me what you believe',
  passions_interests: 'Tell me what you love',
  heritage_roots: 'Tell me about your roots',
  lessons_wisdom: "Share something you've learned",
  hopes_legacy: 'Tell me about your hopes',
  everyday_life: 'Tell me about your daily life',
};

// Enrichment milestones
export const MILESTONES: Array<{
  threshold: number;
  label: string;
  description: string;
}> = [
  {
    threshold: 20,
    label: 'Memory Keeper',
    description: "You've begun sharing your story.",
  },
  {
    threshold: 40,
    label: 'Life Chronicler',
    description: 'Your story is taking shape.',
  },
  {
    threshold: 60,
    label: 'Story Weaver',
    description: 'A rich picture of your life is emerging.',
  },
  {
    threshold: 80,
    label: 'Heritage Guardian',
    description: 'Your story is becoming truly full.',
  },
  {
    threshold: 100,
    label: 'Living Legacy',
    description: 'Your story is complete and vivid.',
  },
];

// ---------------------------------------------------------------------------
// ADDITIONAL TYPES
// ---------------------------------------------------------------------------

export interface MilestoneInfo {
  reached_threshold: number;
  reached_label: string;
  reached_description: string;
  next_threshold: number | null;
  next_label: string | null;
  is_max: boolean;
}

export interface NudgeQuestion {
  category_key: EnrichmentCategory;
  category_label: string;
  question: string;
}

export interface JumpPill {
  category_key: EnrichmentCategory;
  category_label: string;
  starter: string;
}

export interface ConversationEnrichment {
  memory_id: string;
  dimensions: EnrichmentCategory[];
  category_labels: Partial<Record<EnrichmentCategory, string>>;
  message_count: number;
  last_active: string | null;
}

// ---------------------------------------------------------------------------
// MAIN COMPUTATION
// ---------------------------------------------------------------------------

export async function computeEnrichmentScore(
  userId: string,
): Promise<EnrichmentResult> {
  // --- Redis cache read ---
  const cacheKey = enrichmentCacheKey(userId);
  if (redis) {
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(String(cached)) as EnrichmentResult;
    }
  }

  // 1. Fetch all relevant data in parallel (pendingInsights removed — was unused)
  const [persona, conversations, stories] = await Promise.all([
    Persona.findOne({user: userId}).lean(),
    Memory.find({
      user: userId,
      type: 'conversation',
      status: {$nin: ['draft', 'deleted']},
    })
      .select('dimensions summary created_at')
      .lean(),
    Memory.find({
      user: userId,
      type: 'story',
      status: {$in: ['save', 'queued', 'on_chain']},
    })
      .select('dimensions tags created_at')
      .lean(),
  ]);

  // 2. Determine user account age (for deferred unlock logic).
  //    Prefer persona.created_at; fall back to User.created_at to avoid
  //    locking deferred categories forever when persona field is null.
  let userCreatedAt = persona?.created_at ? dayjs(persona.created_at) : null;
  if (!userCreatedAt) {
    const user = await User.findById(userId).select('created_at').lean();
    userCreatedAt = user?.created_at ? dayjs(user.created_at) : dayjs();
  }
  const accountAgeDays = dayjs().diff(userCreatedAt, 'day');

  // 3. Get user priority dimensions from preferences (seeded by onboarding)
  const priorityDimensions: string[] = (persona as any)?.current_priority || [];

  // 4. Count items per category
  const categoryCounts: Record<
    string,
    {explicit: number; derived: number; lastActivity: Date | null}
  > = {};
  for (const cat of ENRICHMENT_CATEGORIES) {
    categoryCounts[cat] = {explicit: 0, derived: 0, lastActivity: null};
  }

  // Count conversation dimensions (AI-derived)
  for (const conv of conversations) {
    const dims = (conv.dimensions as string[]) || [];
    for (const dim of dims) {
      if (categoryCounts[dim]) {
        categoryCounts[dim].derived += 1;
        const convDate = conv.created_at ? new Date(conv.created_at) : null;
        if (
          convDate &&
          (!categoryCounts[dim].lastActivity ||
            convDate > categoryCounts[dim].lastActivity)
        ) {
          categoryCounts[dim].lastActivity = convDate;
        }
      }
    }
  }

  // Count story dimensions AND tags (explicit). Tags were fetched but previously unused.
  for (const story of stories) {
    const dims = [
      ...((story.dimensions as string[]) || []),
      ...((story.tags as string[]) || []),
    ];
    const seen = new Set<string>();
    for (const dim of dims) {
      // Deduplicate within the same story so a tag+dimension match doesn't double-count
      if (!seen.has(dim) && categoryCounts[dim]) {
        seen.add(dim);
        categoryCounts[dim].explicit += 1;
        const storyDate = story.created_at ? new Date(story.created_at) : null;
        if (
          storyDate &&
          (!categoryCounts[dim].lastActivity ||
            storyDate > categoryCounts[dim].lastActivity)
        ) {
          categoryCounts[dim].lastActivity = storyDate;
        }
      }
    }
  }

  // 5. Add base points from persona richness (notes, preferences, goals, etc.)
  const personaFields = [
    {field: 'important_notes', cats: ['identity_self', 'relationships_people']},
    {field: 'key_preferences', cats: ['everyday_life', 'passions_interests']},
    {field: 'goals_and_aspirations', cats: ['work_purpose', 'hopes_legacy']},
    {
      field: 'emotional_state_trends',
      cats: ['identity_self', 'beliefs_worldview'],
    },
  ];

  for (const {field, cats} of personaFields) {
    const items = (persona as any)?.[field];
    if (Array.isArray(items) && items.length > 0) {
      for (const cat of cats) {
        if (categoryCounts[cat]) {
          categoryCounts[cat].derived += Math.min(items.length, 5); // cap contribution
        }
      }
    }
  }

  // 6. Compute per-category scores
  const categoryScores: CategoryScore[] = [];
  let totalWeightedScore = 0;
  let totalWeight = 0;

  for (const cat of ENRICHMENT_CATEGORIES) {
    const counts = categoryCounts[cat];
    const isDeferred = DEFERRED_CATEGORIES[cat] !== undefined;
    const unlocked = !isDeferred || accountAgeDays >= DEFERRED_CATEGORIES[cat];

    // Priority weight: user-chosen dimensions get 1.5×, others get 1.0×
    const weight = priorityDimensions.includes(cat) ? 1.5 : 1.0;

    // Raw score based on item counts (logarithmic curve so it's always growable)
    const weightedItems =
      counts.explicit * EXPLICIT_WEIGHT + counts.derived * CONVERSATION_WEIGHT;
    let rawScore = Math.min(100, Math.round(Math.log2(weightedItems + 1) * 20));

    // Apply decay if inactive.
    // ACTIVITY_PAUSE_DAYS: any activity within this window fully pauses decay.
    // Decay only starts after DECAY_IDLE_DAYS of true inactivity beyond the pause window.
    if (counts.lastActivity) {
      const idleDays = dayjs().diff(dayjs(counts.lastActivity), 'day');
      if (idleDays > ACTIVITY_PAUSE_DAYS && idleDays > DECAY_IDLE_DAYS) {
        const weeksIdle = Math.floor((idleDays - DECAY_IDLE_DAYS) / 7);
        const decayAmount = weeksIdle * DECAY_RATE_PER_WEEK;
        rawScore = Math.max(0, rawScore - decayAmount);
      }
    }

    const score = unlocked ? rawScore : 0;

    categoryScores.push({
      key: cat,
      label: CATEGORY_LABELS[cat],
      score,
      weight,
      itemCount: counts.explicit + counts.derived,
      unlocked,
    });

    if (unlocked) {
      totalWeightedScore += score * weight;
      totalWeight += weight;
    }
  }

  // 7. Compute overall enrichment score (weighted average with floor)
  const rawOverall =
    totalWeight > 0 ? Math.round(totalWeightedScore / totalWeight) : 0;
  const enrichment_score = Math.max(SCORE_FLOOR, rawOverall);

  // 8. Find lowest non-deferred, unlocked category for nudge suggestions
  const activeCats = categoryScores.filter(
    c => c.unlocked && !DEFERRED_CATEGORIES[c.key],
  );
  const lowest =
    activeCats.length > 0
      ? activeCats.reduce((prev, curr) =>
          curr.score < prev.score ? curr : prev,
        )
      : null;

  // 9. Beneficiary access: one-way persistent flag — set it on Persona if earned,
  //    never clear it even when score decays below 20.
  const alreadyUnlocked = persona?.beneficiary_access_unlocked ?? false;
  const earnedNow = enrichment_score >= 20;
  const beneficiary_access_unlocked = alreadyUnlocked || earnedNow;

  if (earnedNow && !alreadyUnlocked) {
    // Persist the flag so future score decay doesn't revoke it
    await Persona.updateOne(
      {user: userId},
      {$set: {beneficiary_access_unlocked: true}},
    );
  }

  const result: EnrichmentResult = {
    enrichment_score,
    category_scores: categoryScores,
    lowest_category: lowest?.key || null,
    beneficiary_access_unlocked,
  };

  // --- Redis cache write ---
  if (redis) {
    await redis.set(cacheKey, JSON.stringify(result), {
      EX: ENRICHMENT_CACHE_TTL,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// MILESTONE
// ---------------------------------------------------------------------------

export function getMilestone(score: number): MilestoneInfo {
  const reached = MILESTONES.filter(m => score >= m.threshold);
  const current =
    reached.length > 0 ? reached[reached.length - 1] : MILESTONES[0];
  const nextIndex = MILESTONES.indexOf(current) + 1;
  const next = nextIndex < MILESTONES.length ? MILESTONES[nextIndex] : null;

  // If score hasn't hit the first threshold yet, use the first milestone as the target
  if (reached.length === 0) {
    return {
      reached_threshold: 0,
      reached_label: 'Just Starting',
      reached_description: 'Share your first story to begin.',
      next_threshold: MILESTONES[0].threshold,
      next_label: MILESTONES[0].label,
      is_max: false,
    };
  }

  return {
    reached_threshold: current.threshold,
    reached_label: current.label,
    reached_description: current.description,
    next_threshold: next?.threshold ?? null,
    next_label: next?.label ?? null,
    is_max: next === null,
  };
}

// ---------------------------------------------------------------------------
// NUDGE + JUMP PILLS
// ---------------------------------------------------------------------------

export function getNudge(
  lowestCategoryKey: string | null,
): NudgeQuestion | null {
  if (!lowestCategoryKey) return null;
  const key = lowestCategoryKey as EnrichmentCategory;
  if (!CATEGORY_NUDGES[key]) return null;
  return {
    category_key: key,
    category_label: CATEGORY_LABELS[key],
    question: CATEGORY_NUDGES[key],
  };
}

export function getJumpPills(
  gapDimensions: string[],
  priorityDimensions: string[],
  limit = 4,
): JumpPill[] {
  // Prefer gap dimensions (unexplored priority dimensions), then fall back to all priorities
  const ordered = [
    ...gapDimensions,
    ...priorityDimensions.filter(d => !gapDimensions.includes(d)),
  ];

  const seen = new Set<string>();
  const pills: JumpPill[] = [];

  for (const dim of ordered) {
    if (seen.has(dim)) continue;
    seen.add(dim);
    const key = dim as EnrichmentCategory;
    if (CATEGORY_STARTERS[key]) {
      pills.push({
        category_key: key,
        category_label: CATEGORY_LABELS[key],
        starter: CATEGORY_STARTERS[key],
      });
    }
    if (pills.length >= limit) break;
  }

  return pills;
}

// ---------------------------------------------------------------------------
// PER-CONVERSATION ENRICHMENT
// ---------------------------------------------------------------------------

export async function getConversationEnrichment(
  memoryId: string,
  userId: string,
): Promise<ConversationEnrichment> {
  const memory = await Memory.findOne({
    _id: memoryId,
    user: userId,
    type: 'conversation',
    status: {$nin: ['draft', 'deleted']},
  })
    .select('dimensions message_count last_active')
    .lean();

  if (!memory) {
    throw new NotFoundException('Conversation not found');
  }

  const dimensions = ((memory.dimensions as string[]) || []).filter(
    (d): d is EnrichmentCategory =>
      ENRICHMENT_CATEGORIES.includes(d as EnrichmentCategory),
  );

  const categoryLabels: Partial<Record<EnrichmentCategory, string>> = {};
  for (const dim of dimensions) {
    categoryLabels[dim] = CATEGORY_LABELS[dim];
  }

  return {
    memory_id: memoryId,
    dimensions,
    category_labels: categoryLabels,
    message_count: (memory.message_count as number) || 0,
    last_active: memory.last_active
      ? new Date(memory.last_active as Date).toISOString()
      : null,
  };
}
