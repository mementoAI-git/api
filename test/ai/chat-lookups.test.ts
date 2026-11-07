import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';

vi.mock('../../src/services/ai/groq', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/services/ai/groq')>()),
  groqClient: {isConfigured: () => true},
  chooseToolCallsWithGroq: vi.fn(async () => []),
}));
vi.mock('../../src/services/embeddings/long-term', () => ({
  getLongTermContext: vi.fn(async () => ''),
  getLongTermRecall: vi.fn(async () => ({text: '', memories: []})),
}));

import {chooseToolCallsWithGroq} from '../../src/services/ai/groq';
import Beneficiary from '../../src/module/database/model/beneficiary';
import Bookmark from '../../src/module/database/model/bookmarks';
import Group from '../../src/module/database/model/group';
import Memory from '../../src/module/database/model/memory';
import {
  lookUpForChat,
  mightNeedLookup,
} from '../../src/module/api/ai/chat-tools/lookups';
import {CHAT_TOOL_HANDLERS} from '../../src/module/api/ai/chat-tools/tools';
import {CHAT_TOOL_DECLARATIONS} from '../../src/module/api/ai/chat-tools/declarations';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';
import {createUserFixture} from '../helpers/factories';

const ORIGIN = 'https://mymemento.io';

async function story(
  userId: string,
  title: string,
  extra: Record<string, unknown> = {},
) {
  return Memory.create({
    user: userId,
    type: 'story',
    status: 'save',
    title,
    body: `<p>${title} body.</p>`,
    ...extra,
  });
}

const choose = vi.mocked(chooseToolCallsWithGroq);

describe('chat lookups', () => {
  beforeAll(connectTestDatabase);
  afterEach(async () => {
    vi.clearAllMocks();
    await clearTestDatabase();
  });
  afterAll(closeTestDatabase);

  it('declares a handler for every tool, and only read-only ones', () => {
    for (const tool of CHAT_TOOL_DECLARATIONS) {
      expect(CHAT_TOOL_HANDLERS).toHaveProperty(tool.name);
    }
    expect(Object.keys(CHAT_TOOL_HANDLERS).sort()).toEqual(
      CHAT_TOOL_DECLARATIONS.map(tool => tool.name).sort(),
    );
    for (const name of Object.keys(CHAT_TOOL_HANDLERS)) {
      expect(name).not.toMatch(/delete|save|edit|share_story|update|set_/);
    }
  });

  it('skips small talk without asking the model', async () => {
    expect(mightNeedLookup('ok')).toBe(false);
    expect(mightNeedLookup('thanks!')).toBe(false);
    expect(mightNeedLookup('share my last story')).toBe(true);
    const user = await createUserFixture();
    const result = await lookUpForChat({
      userId: user.id,
      origin: ORIGIN,
      text: 'hello',
      history: [],
    });
    expect(result.context).toBe('');
    expect(choose).not.toHaveBeenCalled();
  });

  it('gives the share link for the latest story when it is visible to everyone', async () => {
    const user = await createUserFixture();
    await story(user.id, 'Older', {created_at: new Date('2026-01-01')});
    const latest = await story(user.id, 'Trip to Lagos', {
      visibility: 'everyone',
    });
    choose.mockResolvedValueOnce([
      {name: 'get_share_link', arguments: {latest: true}},
    ]);

    const result = await lookUpForChat({
      userId: user.id,
      origin: ORIGIN,
      text: 'share the last story I posted',
      history: [],
    });

    expect(result.context).toContain(`${ORIGIN}/post/${latest._id}`);
    expect(result.context).toContain('LOOKUPS FOR THIS MESSAGE');
    expect(result.targets.get(String(latest._id))).toEqual({
      type: 'story',
      shareable: true,
    });
  });

  it('never offers a link for a private story, and explains the two steps', async () => {
    const user = await createUserFixture();
    const diary = await story(user.id, 'Diary');
    const result = await CHAT_TOOL_HANDLERS.get_share_link(
      {latest: true},
      {userId: user.id, origin: ORIGIN},
    );
    expect(result.text).not.toContain('/post/');
    expect(result.text).toContain('private to them');
    expect(result.text).toContain('two steps');
    expect(result.targets.get(String(diary._id))?.shareable).toBe(false);
  });

  it("reads a story's full text in the host's words", async () => {
    const user = await createUserFixture();
    await story(user.id, 'Trip to Lagos', {
      body: '<p>We landed at night &amp; slept.</p>',
    });
    const result = await CHAT_TOOL_HANDLERS.read_story(
      {query: 'Lagos'},
      {userId: user.id, origin: ORIGIN},
    );
    expect(result.text).toContain('We landed at night & slept.');
  });

  it('lists bookmarked stories only', async () => {
    const user = await createUserFixture();
    const kept = await story(user.id, 'Kept');
    await story(user.id, 'Other');
    await Bookmark.create({user: user.id, memory: String(kept._id)});
    const result = await CHAT_TOOL_HANDLERS.list_stories(
      {filter: 'bookmarked'},
      {userId: user.id, origin: ORIGIN},
    );
    expect(result.text).toContain('"Kept"');
    expect(result.text).not.toContain('"Other"');
  });

  it("lists the host's people and groups, never someone else's", async () => {
    const user = await createUserFixture();
    const other = await createUserFixture();
    await Beneficiary.create({
      benefactor: user.id,
      name: 'Ada',
      email: 'ada@example.com',
      relationship: 'sister',
      status: 'accepted',
    });
    await Beneficiary.create({
      benefactor: other.id,
      name: 'Zed',
      email: 'zed@example.com',
    });
    await Group.create({user: user.id, name: 'Family', members: ['x']});
    const result = await CHAT_TOOL_HANDLERS.list_people(
      {},
      {userId: user.id, origin: ORIGIN},
    );
    expect(result.text).toContain('Ada (sister): joined');
    expect(result.text).toContain('Family (1 people)');
    expect(result.text).not.toContain('Zed');
  });

  it("never reads another host's story", async () => {
    const user = await createUserFixture();
    const other = await createUserFixture();
    await story(other.id, 'Trip to Lagos');
    const result = await CHAT_TOOL_HANDLERS.read_story(
      {query: 'Lagos'},
      {userId: user.id, origin: ORIGIN},
    );
    expect(result.text).toMatch(/No saved story matched/);
  });

  it('goes ahead without lookups when choosing fails', async () => {
    const user = await createUserFixture();
    choose.mockRejectedValueOnce(new Error('Groq down'));
    const result = await lookUpForChat({
      userId: user.id,
      origin: ORIGIN,
      text: 'what did I write about my father?',
      history: [],
    });
    expect(result).toEqual({context: '', targets: new Map(), calls: []});
  });

  it('ignores tools it does not know', async () => {
    const user = await createUserFixture();
    choose.mockResolvedValueOnce([{name: 'delete_story', arguments: {}}]);
    const result = await lookUpForChat({
      userId: user.id,
      origin: ORIGIN,
      text: 'delete my Lagos story please',
      history: [],
    });
    expect(result.context).toBe('');
  });
});
