import dayjs from 'dayjs';
import Memory from '../../module/database/model/memory';
import Persona from '../../module/database/model/persona';
import PendingInsight from '../../module/database/model/pending-insight';

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
  lessons_wisdom: 14,   // unlock after 2 weeks
  hopes_legacy: 21,     // unlock after 3 weeks
};

// Decay settings
const DECAY_IDLE_DAYS = 14;      // start decaying after 14 days idle
const DECAY_RATE_PER_WEEK = 2;   // lose 2% per week per category
const SCORE_FLOOR = 5;           // overall score never below 5%
const ACTIVITY_PAUSE_DAYS = 7;   // any activity within 7 days pauses decay

// Weights for different content sources
const CONVERSATION_WEIGHT = 0.9; // AI-derived content weighted slightly lower
const EXPLICIT_WEIGHT = 1.0;     // user-authored content full weight

// ---------------------------------------------------------------------------
// TYPES
// ---------------------------------------------------------------------------

export interface CategoryScore {
  key: EnrichmentCategory;
  label: string;
  score: number;         // 0–100
  weight: number;        // priority weight (from onboarding)
  itemCount: number;     // how many items tagged to this category
  unlocked: boolean;     // whether this category is active
}

export interface EnrichmentResult {
  enrichment_score: number;              // 0–100 overall
  category_scores: CategoryScore[];
  lowest_category: string | null;        // key of lowest non-deferred active category
  beneficiary_access_unlocked: boolean;  // true if score ever reached 20%
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

// ---------------------------------------------------------------------------
// MAIN COMPUTATION
// ---------------------------------------------------------------------------

export async function computeEnrichmentScore(userId: string): Promise<EnrichmentResult> {
  // 1. Fetch all relevant data in parallel
  const [persona, conversations, stories, pendingInsights] = await Promise.all([
    Persona.findOne({ user: userId }).lean(),
    Memory.find({ user: userId, type: 'conversation', status: { $nin: ['draft', 'deleted'] } })
      .select('dimensions summary created_at')
      .lean(),
    Memory.find({ user: userId, type: 'story', status: { $in: ['save', 'queued', 'on_chain'] } })
      .select('dimensions tags created_at')
      .lean(),
    PendingInsight.countDocuments({ user: userId }),
  ]);

  // 2. Determine user account age (for deferred unlock logic)
  const userCreatedAt = persona?.created_at
    ? dayjs(persona.created_at)
    : dayjs(); // fallback to now
  const accountAgeDays = dayjs().diff(userCreatedAt, 'day');

  // 3. Get user priority dimensions from preferences (seeded by onboarding)
  const priorityDimensions: string[] = (persona as any)?.current_priority || [];

  // 4. Count items per category
  const categoryCounts: Record<string, { explicit: number; derived: number; lastActivity: Date | null }> = {};
  for (const cat of ENRICHMENT_CATEGORIES) {
    categoryCounts[cat] = { explicit: 0, derived: 0, lastActivity: null };
  }

  // Count conversation dimensions (AI-derived)
  for (const conv of conversations) {
    const dims = (conv.dimensions as string[]) || [];
    for (const dim of dims) {
      if (categoryCounts[dim]) {
        categoryCounts[dim].derived += 1;
        const convDate = conv.created_at ? new Date(conv.created_at) : null;
        if (convDate && (!categoryCounts[dim].lastActivity || convDate > categoryCounts[dim].lastActivity)) {
          categoryCounts[dim].lastActivity = convDate;
        }
      }
    }
  }

  // Count story dimensions/tags (explicit)
  for (const story of stories) {
    const dims = (story.dimensions as string[]) || [];
    for (const dim of dims) {
      if (categoryCounts[dim]) {
        categoryCounts[dim].explicit += 1;
        const storyDate = story.created_at ? new Date(story.created_at) : null;
        if (storyDate && (!categoryCounts[dim].lastActivity || storyDate > categoryCounts[dim].lastActivity)) {
          categoryCounts[dim].lastActivity = storyDate;
        }
      }
    }
  }

  // 5. Add base points from persona richness (notes, preferences, goals, etc.)
  const personaFields = [
    { field: 'important_notes', cats: ['identity_self', 'relationships_people'] },
    { field: 'key_preferences', cats: ['everyday_life', 'passions_interests'] },
    { field: 'goals_and_aspirations', cats: ['work_purpose', 'hopes_legacy'] },
    { field: 'emotional_state_trends', cats: ['identity_self', 'beliefs_worldview'] },
  ];

  for (const { field, cats } of personaFields) {
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
    const weightedItems = (counts.explicit * EXPLICIT_WEIGHT) + (counts.derived * CONVERSATION_WEIGHT);
    let rawScore = Math.min(100, Math.round(Math.log2(weightedItems + 1) * 20));

    // Apply decay if inactive
    if (counts.lastActivity) {
      const idleDays = dayjs().diff(dayjs(counts.lastActivity), 'day');
      if (idleDays > DECAY_IDLE_DAYS) {
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
  const rawOverall = totalWeight > 0 ? Math.round(totalWeightedScore / totalWeight) : 0;
  const enrichment_score = Math.max(SCORE_FLOOR, rawOverall);

  // 8. Find lowest non-deferred, unlocked category for nudge suggestions
  const activeCats = categoryScores.filter(c => c.unlocked && !DEFERRED_CATEGORIES[c.key]);
  const lowest = activeCats.length > 0
    ? activeCats.reduce((prev, curr) => curr.score < prev.score ? curr : prev)
    : null;

  // 9. Beneficiary access: unlocked forever once score hits 20%
  const beneficiary_access_unlocked = enrichment_score >= 20;

  return {
    enrichment_score,
    category_scores: categoryScores,
    lowest_category: lowest?.key || null,
    beneficiary_access_unlocked,
  };
}
