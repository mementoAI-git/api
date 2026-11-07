import request from 'supertest';
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';

// CI has no FRONTEND_URL; the page needs the app's origin for its links.
vi.mock('../../src/utils/config', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/utils/config')>()),
  FRONTEND_URL: 'https://app.mymemento.io',
}));
import Memory from '../../src/module/database/model/memory';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';
import {createTestApp} from '../helpers/app';
import {createUserFixture} from '../helpers/factories';

describe('GET /public/stories/:id (link previews for shared stories)', () => {
  beforeAll(connectTestDatabase);
  afterEach(clearTestDatabase);
  afterAll(closeTestDatabase);

  it('serves a story visible to everyone with its own preview tags', async () => {
    const user = await createUserFixture();
    const story = await Memory.create({
      user: user.id,
      type: 'story',
      status: 'save',
      title: 'Lagos "at night"',
      body: '<p>We landed &amp; slept.</p>',
      visibility: 'everyone',
    });

    const res = await request(createTestApp()).get(
      `/public/stories/${story._id}`,
    );

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers['content-security-policy']).toContain(
      "default-src 'none'",
    );
    expect(res.text).toContain(
      '<meta property="og:title" content="Lagos &quot;at night&quot; · Memento">',
    );
    expect(res.text).toContain(
      '<meta property="og:description" content="We landed &amp; slept.">',
    );
    expect(res.text).toMatch(/og:url" content="https?:\/\/[^"]+\/post\//);
  });

  it('never serves a private story', async () => {
    const user = await createUserFixture();
    const story = await Memory.create({
      user: user.id,
      type: 'story',
      status: 'save',
      title: 'Diary',
    });
    const res = await request(createTestApp()).get(
      `/public/stories/${story._id}`,
    );
    expect(res.status).toBe(404);
    expect(res.text).not.toContain('Diary');
  });
});
