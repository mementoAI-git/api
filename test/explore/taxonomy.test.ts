import {describe, expect, it} from 'vitest';
import {
  EXPLORE_CATEGORIES,
  exploreArtworkFor,
  LEGACY_EXPLORE_CATEGORY_ALIASES,
  resolveExploreCategorySlug,
} from '../../src/module/api/prompt/explore-taxonomy';

describe('explore taxonomy', () => {
  it('ships the 11 canonical categories in order', () => {
    expect(EXPLORE_CATEGORIES).toHaveLength(11);
    expect(EXPLORE_CATEGORIES.map(c => c.slug)).toContain('growing-up');
    for (const c of EXPLORE_CATEGORIES) {
      expect(c.title.length).toBeGreaterThan(0);
      expect(c.description.length).toBeGreaterThan(0);
    }
  });

  it('resolves canonical slugs and legacy aliases', () => {
    expect(resolveExploreCategorySlug('growing-up')).toBe('growing-up');
    expect(resolveExploreCategorySlug('Growing-Up')).toBe('growing-up');
    expect(resolveExploreCategorySlug('career')).toBe('work-purpose');
    expect(resolveExploreCategorySlug('family')).toBe('people-i-love');
    expect(resolveExploreCategorySlug('identity')).toBe('who-i-am');
    expect(resolveExploreCategorySlug('nope')).toBeNull();
    expect(Object.keys(LEGACY_EXPLORE_CATEGORY_ALIASES).length).toBeGreaterThan(0);
  });

  it('builds versioned artwork urls with srcset widths', () => {
    const art = exploreArtworkFor('growing-up', 'https://cdn.mymemento.io');
    expect(art.src).toContain('growing-up-768.webp');
    expect(art.src).toContain('v=');
    for (const w of [480, 768, 1024, 1440]) {
      expect(art.srcSet).toContain(`growing-up-${w}.webp?v=v1 ${w}w`);
    }
  });
});
