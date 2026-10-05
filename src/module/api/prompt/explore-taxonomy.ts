/**
 * Explore taxonomy — server-owned source of truth for prompt categories.
 *
 * Ported from web/src/utility/data/categories.ts + explore-catalog.generated.json.
 * Clients must treat this module as canonical: any slug/title/description
 * change happens here, and the bundled client fallbacks are generated from
 * `GET /prompts/categories` output (never hand-maintained).
 */

export interface ExploreCategory {
  slug: string;
  title: string;
  description: string;
  order: number;
  starterTotal: number;
  artwork: {
    src: string;
    srcSet: string;
  };
}

export const EXPLORE_CATEGORIES: Omit<ExploreCategory, 'artwork'>[] = [
  {
    slug: 'growing-up',
    title: 'Growing Up',
    description:
      'Childhood, school, early memories, firsts, and formative experiences.',
    order: 0,
    starterTotal: 10,
  },
  {
    slug: 'people-i-love',
    title: 'People I Love',
    description:
      'Family, friendships, romantic relationships, and important people.',
    order: 1,
    starterTotal: 10,
  },
  {
    slug: 'the-life-i-live',
    title: 'The Life I Live',
    description:
      'Routines, home, habits, everyday life, and how you spend your time.',
    order: 2,
    starterTotal: 10,
  },
  {
    slug: 'things-i-love',
    title: 'Things I Love',
    description:
      'Music, food, hobbies, interests, places, entertainment, and personal favorites.',
    order: 3,
    starterTotal: 10,
  },
  {
    slug: 'who-i-am',
    title: 'Who I Am',
    description:
      'Personality, identity, strengths, fears, quirks, and self-perception.',
    order: 4,
    starterTotal: 10,
  },
  {
    slug: 'work-purpose',
    title: 'Work & Purpose',
    description:
      'Career, ambition, money, contribution, meaningful work, and purpose.',
    order: 5,
    starterTotal: 10,
  },
  {
    slug: 'beliefs-faith',
    title: 'Beliefs & Faith',
    description:
      'Religion, spirituality, values, morality, worldview, meaning, and doubt.',
    order: 6,
    starterTotal: 10,
  },
  {
    slug: 'where-i-come-from',
    title: 'Where I Come From',
    description:
      'Family history, heritage, culture, traditions, community, and place.',
    order: 7,
    starterTotal: 10,
  },
  {
    slug: 'stories-adventures',
    title: 'Stories & Adventures',
    description:
      'Travel, memorable experiences, funny stories, adventures, and unusual moments.',
    order: 8,
    starterTotal: 10,
  },
  {
    slug: 'what-life-taught-me',
    title: 'What Life Taught Me',
    description:
      'Lessons, mistakes, advice, growth, perspective, and difficult periods.',
    order: 9,
    starterTotal: 10,
  },
  {
    slug: 'whats-ahead',
    title: "What's Ahead",
    description:
      'Hopes, goals, dreams, future experiences, and unfinished ambitions.',
    order: 10,
    starterTotal: 10,
  },
];

/** Legacy slugs (pre-canonical taxonomy) resolved to their canonical target. */
export const LEGACY_CATEGORY_ALIASES: Record<string, string> = {
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
  experience: 'stories-adventures',
  identify: 'who-i-am',
};

const CANONICAL_SLUGS = new Set(EXPLORE_CATEGORIES.map(c => c.slug));

export function resolveExploreCategorySlug(
  value?: string | null,
): string | null {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  if (CANONICAL_SLUGS.has(normalized)) return normalized;
  return LEGACY_CATEGORY_ALIASES[normalized] ?? null;
}

/** Version/query bump for artwork cache invalidation (bump when masters change). */
export const EXPLORE_ARTWORK_VERSION = 'v1';

const ARTWORK_WIDTHS = [480, 768, 1024, 1440];

/**
 * Artwork URLs for a canonical slug. Files live at
 * `artwork/explore/{slug}-{width}.webp` in the public file store
 * (same R2/CDN pipeline as user uploads — see services/storage).
 * Upload is an ops step; until then clients use bundled covers.
 */
export function exploreArtworkFor(
  slug: string,
  baseUrl: string,
): ExploreCategory['artwork'] {
  const base = baseUrl.replace(/\/$/, '');
  const src = (w: number) =>
    `${base}/artwork/explore/${slug}-${w}.webp?v=${EXPLORE_ARTWORK_VERSION}`;
  return {
    src: src(768),
    srcSet: ARTWORK_WIDTHS.map(w => `${src(w)} ${w}w`).join(', '),
  };
}

export function getExploreCatalog(baseUrl: string): ExploreCategory[] {
  return EXPLORE_CATEGORIES.map(category => ({
    ...category,
    artwork: exploreArtworkFor(category.slug, baseUrl),
  }));
}
