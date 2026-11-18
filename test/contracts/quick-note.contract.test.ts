import request from 'supertest';
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
import Memory from '../../src/module/database/model/memory';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';
import {createTestApp} from '../helpers/app';
import {createUserFixture, issueLegacyAccessToken} from '../helpers/factories';
import {shouldOverwriteQuickCaptureTitle} from '../../src/utils/quick-note';

vi.mock('../../src/module/api/user/service', async original => ({
  ...(await original<typeof import('../../src/module/api/user/service')>()),
  updateStreak: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/services/enrichment', async original => ({
  ...(await original<typeof import('../../src/services/enrichment')>()),
  invalidateEnrichmentCache: vi.fn().mockResolvedValue(undefined),
}));

describe('quick-note save contract', () => {
  beforeAll(connectTestDatabase);
  afterEach(clearTestDatabase);
  afterAll(closeTestDatabase);

  it('persists the Quick note name for web and mobile quick captures', async () => {
    const user = await createUserFixture();
    const response = await request(createTestApp())
      .post('/memories/quick-capture')
      .set('Authorization', `Bearer ${issueLegacyAccessToken(user)}`)
      .send({body: 'A small memory', visibility: 'private'});
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      title: 'Quick note',
      body: 'A small memory',
      capture_source: 'quick',
    });
    expect((await Memory.findById(response.body.data._id))?.title).toBe(
      'Quick note',
    );
  });

  it('starts an auto-titled capture with a placeholder the worker can rename', async () => {
    const user = await createUserFixture();
    const response = await request(createTestApp())
      .post('/memories/quick-capture')
      .set('Authorization', `Bearer ${issueLegacyAccessToken(user)}`)
      .send({
        body: 'A recorded memory',
        visibility: 'private',
        auto_title: true,
      });
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      title: 'Voice note',
      capture_source: 'quick',
      enrichment_status: 'pending',
    });
    expect(shouldOverwriteQuickCaptureTitle(response.body.data.title)).toBe(
      true,
    );
  });

  it('preserves automatic classification when promoting a cloud draft', async () => {
    const user = await createUserFixture();
    const draft = await Memory.create({
      user: user.id,
      title: 'Draft',
      body: '',
      status: 'draft',
    });
    const response = await request(createTestApp())
      .put(`/memories/${draft.id}`)
      .set('Authorization', `Bearer ${issueLegacyAccessToken(user)}`)
      .send({
        title: 'Quick note',
        body: '<p>A title-only entry</p>',
        capture_source: 'quick',
        status: 'save',
      });
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      title: 'Quick note',
      capture_source: 'quick',
      status: 'save',
    });
    expect((await Memory.findById(draft.id))?.capture_source).toBe('quick');
  });

  it('persists an automatic quick note created from the editor', async () => {
    const user = await createUserFixture();
    const response = await request(createTestApp())
      .post('/memories')
      .set('Authorization', `Bearer ${issueLegacyAccessToken(user)}`)
      .send({
        title: 'Quick note',
        body: '<p>Body-only entry</p>',
        capture_source: 'quick',
        tags: [],
        status: 'save',
      });
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      title: 'Quick note',
      capture_source: 'quick',
    });
  });

  it('rejects unsupported capture classifications', async () => {
    const user = await createUserFixture();
    const response = await request(createTestApp())
      .post('/memories')
      .set('Authorization', `Bearer ${issueLegacyAccessToken(user)}`)
      .send({title: 'Note', body: 'Content', capture_source: 'invalid'});
    expect(response.status).toBe(422);
    expect(await Memory.countDocuments()).toBe(0);
  });
});
