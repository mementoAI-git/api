import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';

vi.mock('../../src/services/supermemory', () => ({
  getContextForUser: vi.fn(),
}));

import * as supermemory from '../../src/services/supermemory';
import Memory from '../../src/module/database/model/memory';
import {
  NO_MEMORY_MATCH_RESULT,
  searchMemoriesForVoice,
} from '../../src/module/api/ai/voice/memory-search';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';
import {createUserFixture} from '../helpers/factories';

const getContextForUser = vi.mocked(supermemory.getContextForUser);

describe('searchMemoriesForVoice', () => {
  beforeAll(connectTestDatabase);
  afterEach(async () => {
    getContextForUser.mockReset();
    await clearTestDatabase();
  });
  afterAll(closeTestDatabase);

  it("finds the caller's saved memories by title, summary or topic", async () => {
    getContextForUser.mockResolvedValue({formatedText: ''} as any);
    const user = await createUserFixture();
    const other = await createUserFixture();
    await Memory.create({
      user: user.id,
      type: 'story',
      status: 'save',
      title: "Grandma's farm",
      summary: 'Summers with goats.',
    });
    await Memory.create({
      user: user.id,
      type: 'conversation',
      status: 'save',
      title: 'Chat',
      summary: 'Talked about work.',
      topics: ['farm life'],
    });
    await Memory.create({
      user: user.id,
      type: 'story',
      status: 'draft',
      title: 'Farm draft',
    });
    await Memory.create({
      user: other.id,
      type: 'story',
      status: 'save',
      title: 'Other farm',
    });

    const result = await searchMemoriesForVoice(user.id, 'the farm');

    expect(result).toContain("Grandma's farm");
    expect(result).toContain('Summers with goats.');
    expect(result).toContain('Talked about work.');
    expect(result).not.toContain('Farm draft');
    expect(result).not.toContain('Other farm');
  });

  it('adds long-term facts and caps the result length', async () => {
    getContextForUser.mockResolvedValue({
      formatedText: 'Sister is named Ada. '.repeat(200),
    } as any);
    const user = await createUserFixture();

    const result = await searchMemoriesForVoice(user.id, 'sister');

    expect(result).toContain('Related facts:');
    expect(result.length).toBeLessThanOrEqual(1_500);
  });

  it('treats regex characters in the query as plain text', async () => {
    getContextForUser.mockResolvedValue({formatedText: ''} as any);
    const user = await createUserFixture();
    await Memory.create({
      user: user.id,
      type: 'story',
      status: 'save',
      title: 'C++ class',
    });

    await expect(
      searchMemoriesForVoice(user.id, '(c++ .* [class'),
    ).resolves.toContain('C++ class');
  });

  it('returns a speakable no-match message and never waits on a slow lookup', async () => {
    getContextForUser.mockReturnValue(new Promise(() => undefined) as any);
    const user = await createUserFixture();

    const started = Date.now();
    const result = await searchMemoriesForVoice(user.id, 'anything', {
      longTermTimeoutMs: 25,
    });

    expect(Date.now() - started).toBeLessThan(2_000);
    expect(result).toBe(NO_MEMORY_MATCH_RESULT);
  });
});
