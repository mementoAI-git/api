import {describe, expect, it, vi} from 'vitest';
import request from 'supertest';
import {createTestApp} from '../helpers/app';

vi.mock('../../src/utils/config', async importOriginal => {
  const actual: any = await importOriginal();
  return {...actual, BACKEND_URL: 'https://cdn.mymemento.io'};
});

import {getExploreCategories} from '../../src/module/api/prompt/service';

describe('getExploreCategories (merged)', () => {
  it('returns 11 artwork-enriched categories', async () => {
    const r: any = await getExploreCategories();
    expect(r.data).toHaveLength(11);
    expect(r.data[0].slug).toBe('growing-up');
    expect(r.data[0].order).toBe(0);
    for (const c of r.data) {
      expect(c.artwork.src).toContain(`${c.slug}-768.webp`);
    }
  });

  it('mounts GET /prompts/categories behind auth (401, not 404)', async () => {
    const res = await request(createTestApp()).get('/prompts/categories');
    expect([401, 403]).toContain(res.status);
  });
});
