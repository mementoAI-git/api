export const EXPLORE_CATEGORIES = [
  {
    slug: 'growing-up',
    title: 'Growing Up',
    description:
      'Childhood, school, early memories, firsts, and formative experiences.',
  },
  {
    slug: 'people-i-love',
    title: 'People I Love',
    description:
      'Family, friendships, romantic relationships, and important people.',
  },
  {
    slug: 'the-life-i-live',
    title: 'The Life I Live',
    description:
      'Routines, home, habits, everyday life, and how you spend your time.',
  },
  {
    slug: 'things-i-love',
    title: 'Things I Love',
    description:
      'Music, food, hobbies, interests, places, entertainment, and personal favorites.',
  },
  {
    slug: 'who-i-am',
    title: 'Who I Am',
    description:
      'Personality, identity, strengths, fears, quirks, and self-perception.',
  },
  {
    slug: 'work-purpose',
    title: 'Work & Purpose',
    description:
      'Career, ambition, money, contribution, meaningful work, and purpose.',
  },
  {
    slug: 'beliefs-faith',
    title: 'Beliefs & Faith',
    description:
      'Religion, spirituality, values, morality, worldview, meaning, and doubt.',
  },
  {
    slug: 'where-i-come-from',
    title: 'Where I Come From',
    description:
      'Family history, heritage, culture, traditions, community, and place.',
  },
  {
    slug: 'stories-adventures',
    title: 'Stories & Adventures',
    description:
      'Travel, memorable experiences, funny stories, adventures, and unusual moments.',
  },
  {
    slug: 'what-life-taught-me',
    title: 'What Life Taught Me',
    description:
      'Lessons, mistakes, advice, growth, perspective, and difficult periods.',
  },
  {
    slug: 'whats-ahead',
    title: "What's Ahead",
    description:
      'Hopes, goals, dreams, future experiences, and unfinished ambitions.',
  },
] as const;

export type ExploreCategorySlug = (typeof EXPLORE_CATEGORIES)[number]['slug'];

export const LEGACY_EXPLORE_CATEGORY_ALIASES = {
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
} as const satisfies Record<string, ExploreCategorySlug>;

const EXPLORE_CATEGORY_SLUGS = new Set<string>(
  EXPLORE_CATEGORIES.map(category => category.slug),
);

export function isExploreCategorySlug(
  value: string,
): value is ExploreCategorySlug {
  return EXPLORE_CATEGORY_SLUGS.has(value);
}

export function resolveExploreCategorySlug(
  value: string,
): ExploreCategorySlug | null {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (isExploreCategorySlug(normalized)) return normalized;
  return (
    LEGACY_EXPLORE_CATEGORY_ALIASES[
      normalized as keyof typeof LEGACY_EXPLORE_CATEGORY_ALIASES
    ] ?? null
  );
}

export function getCompatibleExploreCategoryValues(
  canonical: ExploreCategorySlug,
): string[] {
  return [
    canonical,
    ...Object.entries(LEGACY_EXPLORE_CATEGORY_ALIASES)
      .filter(([, target]) => target === canonical)
      .map(([legacy]) => legacy),
  ];
}
