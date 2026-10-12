import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';

vi.mock('../../src/services/supermemory', () => ({
  getContextForUser: vi.fn(),
}));

import * as supermemory from '../../src/services/supermemory';
import Memory from '../../src/module/database/model/memory';
import Message from '../../src/module/database/model/message';
import {
  MEMORY_SEARCH_UNAVAILABLE_RESULT,
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

  it("searches the host's own words and quotes them", async () => {
    getContextForUser.mockResolvedValue({formatedText: ''} as any);
    const user = await createUserFixture();
    await Memory.create({
      user: user.id,
      type: 'story',
      status: 'save',
      title: 'Behind the house',
      body: '<p>Every rainy season we planted <b>yams</b> behind the house with Papa.</p>',
    });

    const result = await searchMemoriesForVoice(user.id, 'yams');

    expect(result).toContain('Behind the house');
    expect(result).toContain('planted yams behind the house');
    expect(result).not.toContain('<b>');
  });

  it('ranks the most relevant memory first, not just the newest', async () => {
    getContextForUser.mockResolvedValue({formatedText: ''} as any);
    const user = await createUserFixture();
    await Memory.create({
      user: user.id,
      type: 'story',
      status: 'save',
      title: 'Lagos trip with Ada',
      updated_at: new Date('2025-01-01'),
    });
    await Memory.create({
      user: user.id,
      type: 'story',
      status: 'save',
      title: 'Work notes',
      summary: 'A short trip to the office.',
      updated_at: new Date('2026-09-01'),
    });

    const result = await searchMemoriesForVoice(
      user.id,
      'my trip to Lagos with Ada',
    );

    expect(result.indexOf('Lagos trip with Ada')).toBeGreaterThan(-1);
    expect(result.indexOf('Lagos trip with Ada')).toBeLessThan(
      result.indexOf('Work notes'),
    );
  });

  it('ignores filler words, so a vague question does not match everything', async () => {
    getContextForUser.mockResolvedValue({formatedText: ''} as any);
    const user = await createUserFixture();
    await Memory.create({
      user: user.id,
      type: 'story',
      status: 'save',
      title: 'What the day was about',
    });

    await expect(
      searchMemoriesForVoice(user.id, 'what about the'),
    ).resolves.toBe(NO_MEMORY_MATCH_RESULT);
  });

  it('labels dates as when a memory was saved, not when it happened', async () => {
    getContextForUser.mockResolvedValue({formatedText: ''} as any);
    const user = await createUserFixture();
    await Memory.create({
      user: user.id,
      type: 'story',
      status: 'save',
      title: 'Wedding day',
      created_at: new Date('2026-03-15'),
    });

    await expect(searchMemoriesForVoice(user.id, 'wedding')).resolves.toContain(
      'Wedding day (saved March 2026)',
    );
  });

  // "No match" makes Memento tell the host nothing is saved. A broken search
  // must not sound like that.
  it('says the search is unavailable, not that nothing is saved, when the lookup fails', async () => {
    getContextForUser.mockResolvedValue({formatedText: ''} as any);
    const user = await createUserFixture();
    vi.spyOn(Memory, 'find').mockImplementation(() => {
      throw new Error('database down');
    });

    await expect(searchMemoriesForVoice(user.id, 'farm')).resolves.toBe(
      MEMORY_SEARCH_UNAVAILABLE_RESULT,
    );
  });

  describe('past conversations', () => {
    async function conversation(userId: string, title = 'Chat') {
      return Memory.create({
        user: userId,
        type: 'conversation',
        status: 'save',
        title,
      });
    }

    it('finds what the host said in earlier chats and voice calls, in their own words', async () => {
      getContextForUser.mockResolvedValue({formatedText: ''} as any);
      const user = await createUserFixture();
      const chat = await conversation(user.id);
      await Message.create({
        user: user.id,
        memory: chat.id,
        role: 'user',
        text: 'My brother Emeka is moving to Toronto next spring.',
        created_at: new Date('2026-03-04'),
      });
      await Message.create({
        user: user.id,
        memory: chat.id,
        role: 'user',
        text: 'Emeka called me today, he got the visa!',
        is_voice: true,
        voice_session_id: 'call-1',
        voice_turn_index: 0,
        created_at: new Date('2026-05-10'),
      });

      const result = await searchMemoriesForVoice(user.id, 'Emeka');

      expect(result).toContain('From past conversations');
      expect(result).toContain('moving to Toronto');
      expect(result).toContain('he got the visa');
      expect(result).toMatch(/voice call \(May 2026\)/);
      expect(result).toMatch(/chat \(March 2026\)/);
    });

    it("never returns Memento's own lines or another person's conversations", async () => {
      getContextForUser.mockResolvedValue({formatedText: ''} as any);
      const user = await createUserFixture();
      const other = await createUserFixture();
      const mine = await conversation(user.id);
      const theirs = await conversation(other.id);
      await Message.create({
        user: user.id,
        memory: mine.id,
        role: 'ai',
        text: 'Tell me about Emeka.',
      });
      await Message.create({
        user: other.id,
        memory: theirs.id,
        role: 'user',
        text: 'Emeka is my cousin.',
      });

      const result = await searchMemoriesForVoice(user.id, 'Emeka');

      expect(result).toBe(NO_MEMORY_MATCH_RESULT);
    });

    it('skips conversations the host deleted', async () => {
      getContextForUser.mockResolvedValue({formatedText: ''} as any);
      const user = await createUserFixture();
      const gone = await Memory.create({
        user: user.id,
        type: 'conversation',
        status: 'deleted',
        title: 'Chat',
      });
      await Message.create({
        user: user.id,
        memory: gone.id,
        role: 'user',
        text: 'Emeka secrets',
      });

      expect(await searchMemoriesForVoice(user.id, 'Emeka')).toBe(
        NO_MEMORY_MATCH_RESULT,
      );
    });
  });
});
