import * as activityService from '../../src/module/api/activity/service';
import {invalidateEnrichmentCache} from '../../src/services/enrichment';
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
import {
  connectTestDatabase,
  clearTestDatabase,
  closeTestDatabase,
} from '../helpers/database';
import Memory from '../../src/module/database/model/memory';
import {
  deleteMemory,
  restoreMemory,
  getStoryMemories,
  memoryStats,
} from '../../src/module/api/memory/service';
vi.mock('../../src/services/queues/memory-search', () => ({
  queueMemorySearch: vi.fn(),
}));
vi.mock('../../src/services/enrichment', () => ({
  invalidateEnrichmentCache: vi.fn().mockResolvedValue(undefined),
  getConversationEnrichment: vi.fn(),
}));
const owner = '000000000000000000000001';
const list = (deleted = false) =>
  getStoryMemories({page: 1, limit: 25, deleted}, owner);
describe('memory recovery list contract', () => {
  beforeAll(connectTestDatabase);
  afterEach(clearTestDatabase);
  afterAll(closeTestDatabase);
  it('moves a deleted memory back to active Stories and updates both counts', async () => {
    const memory = await Memory.create({
      user: owner,
      status: 'save',
      title: 'Recovery fixture',
      type: 'story',
    });
    const result = await deleteMemory(
      {memory_id: memory.id, delete_permanently: false},
      owner,
    );
    expect(result.data.status).toBe('deleted');
    expect((await list()).data.docs).toHaveLength(0);
    const deleted = (await list(true)).data.docs;
    expect(deleted).toHaveLength(1);
    expect(deleted[0]).toMatchObject({
      status: 'deleted',
      deleted_at: expect.any(Date),
      delete_after: expect.any(Date),
    });
    expect(deleted[0]).not.toHaveProperty('previous_status');
    expect((await memoryStats(owner)).data.stories_deleted_count).toBe(1);
    expect((await restoreMemory(memory.id, owner)).data.status).toBe('save');
    expect((await list(true)).data.docs).toHaveLength(0);
    expect((await list()).data.docs).toHaveLength(1);
    expect((await memoryStats(owner)).data).toMatchObject({
      stories_deleted_count: 0,
      stories_count: 1,
    });
  });
  it('removes irreversible purge claims from Deleted immediately and initializes old deletion dates', async () => {
    const memory = await Memory.create({
      user: owner,
      status: 'deleted',
      title: 'Legacy fixture',
      type: 'story',
    });
    const deleted = (await list(true)).data.docs;
    expect(deleted[0]).toHaveProperty('delete_after');
    await deleteMemory({memory_id: memory.id, delete_permanently: true}, owner);
    expect((await list(true)).data.docs).toHaveLength(0);
    expect((await memoryStats(owner)).data.stories_deleted_count).toBe(0);
    await expect(restoreMemory(memory.id, owner)).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it('deletes drafts without publishing activity and tolerates cache invalidation failure', async () => {
    const track = vi
      .spyOn(activityService, 'track')
      .mockResolvedValue(undefined);
    vi.mocked(invalidateEnrichmentCache).mockRejectedValueOnce(
      new Error('Cache unavailable'),
    );
    const draft = await Memory.create({
      user: owner,
      status: 'draft',
      title: 'Private draft',
    });
    const result = await deleteMemory(
      {memory_id: draft.id, delete_permanently: false},
      owner,
    );
    expect(result.data.status).toBe('deleted');
    expect(track).not.toHaveBeenCalled();
  });
});
