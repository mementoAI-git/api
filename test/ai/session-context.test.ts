import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
import dayjs from 'dayjs';
import Memory from '../../src/module/database/model/memory';
import {getSessionContext} from '../../src/utils/ai-prompt';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';
import {createUserFixture} from '../helpers/factories';

describe('getSessionContext', () => {
  beforeAll(connectTestDatabase);
  afterEach(async () => {
    vi.restoreAllMocks();
    await clearTestDatabase();
  });
  afterAll(closeTestDatabase);

  it('counts conversations, reports the newest summary, and merges dimensions', async () => {
    const user = await createUserFixture();
    await Memory.create({
      user: user.id,
      type: 'conversation',
      status: 'save',
      summary: 'Older chat',
      topics: ['work'],
      dimensions: ['career'],
      created_at: dayjs().subtract(2, 'day').toDate(),
    });
    await Memory.create({
      user: user.id,
      type: 'conversation',
      status: 'save',
      summary: 'Newest chat',
      topics: ['family'],
      dimensions: ['family', 'career'],
    });
    await Memory.create({user: user.id, type: 'story', status: 'save'});

    const ctx = await getSessionContext(user.id);

    expect(ctx.sessionCount).toBe(2);
    expect(ctx.lastSession?.summary).toBe('Newest chat');
    expect(ctx.lastSession?.topics).toEqual(['family']);
  });

  it('returns null lastSession when the newest conversation is unsummarized', async () => {
    const user = await createUserFixture();
    await Memory.create({
      user: user.id,
      type: 'conversation',
      status: 'save',
      summary: 'Old',
      created_at: dayjs().subtract(1, 'day').toDate(),
    });
    await Memory.create({user: user.id, type: 'conversation', status: 'save'});

    const ctx = await getSessionContext(user.id);

    expect(ctx.sessionCount).toBe(2);
    expect(ctx.lastSession).toBeNull();
  });

  it('does not load full conversation documents', async () => {
    const user = await createUserFixture();
    const findSpy = vi.spyOn(Memory, 'find');

    await getSessionContext(user.id);

    // computeEnrichmentScore has its own projected, cached query that also
    // filters on status. Only the unbounded session query must be gone.
    const unboundedCalls = (findSpy.mock.calls as unknown[][]).filter(
      ([filter]) => {
        const keys = Object.keys((filter as object) || {}).sort();
        return keys.length === 2 && keys[0] === 'type' && keys[1] === 'user';
      },
    );
    expect(unboundedCalls).toHaveLength(0);
  });
});
