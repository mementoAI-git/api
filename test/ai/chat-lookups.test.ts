import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';

vi.mock('../../src/services/ai/groq', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/services/ai/groq')>()),
  groqClient: {isConfigured: () => true},
  chooseToolCallsWithGroq: vi.fn(async () => []),
}));
const {generateContent} = vi.hoisted(() => ({
  generateContent: vi.fn(async (): Promise<unknown> => {
    throw new Error('Gemini unavailable');
  }),
}));
vi.mock('../../src/services/gemini', () => ({
  default: {models: {generateContent}},
  GEMINI_MODEL: 'gemini-test',
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
import {
  CHAT_ACTION_DECLARATIONS,
  CHAT_ACTION_NAMES,
} from '../../src/module/api/ai/chat-tools/actions';
import {confirmChatAction} from '../../src/module/api/ai/chat-tools/confirm';
import Message from '../../src/module/database/model/message';
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

  it('asks Gemini to choose when Groq is over its limits', async () => {
    const user = await createUserFixture();
    await story(user.id, 'Trip to Lagos');
    choose.mockRejectedValueOnce(new Error('429'));
    generateContent.mockResolvedValueOnce({
      functionCalls: [{name: 'read_story', args: {query: 'Lagos'}}],
    });
    const result = await lookUpForChat({
      userId: user.id,
      origin: ORIGIN,
      text: 'what did I write about Lagos?',
      history: [],
    });
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(result.context).toContain('Trip to Lagos body.');
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
    expect(result).toEqual({
      context: '',
      targets: new Map(),
      calls: [],
      confirmations: [],
    });
  });

  it('ignores tools it does not know', async () => {
    const user = await createUserFixture();
    choose.mockResolvedValueOnce([{name: 'delete_account', arguments: {}}]);
    const result = await lookUpForChat({
      userId: user.id,
      origin: ORIGIN,
      text: 'delete my Lagos story please',
      history: [],
    });
    expect(result.context).toBe('');
  });

  describe('actions', () => {
    async function conversation(userId: string) {
      return Memory.create({
        user: userId,
        type: 'conversation',
        status: 'save',
      });
    }

    it('offers the voice actions in JSON Schema, without the confirmation code', () => {
      expect(CHAT_ACTION_DECLARATIONS.map(tool => tool.name).sort()).toEqual(
        [...CHAT_ACTION_NAMES].sort(),
      );
      const share = CHAT_ACTION_DECLARATIONS.find(
        t => t.name === 'share_story',
      )!;
      expect(share.parameters).toMatchObject({type: 'object'});
      expect(JSON.stringify(share.parameters)).not.toContain('confirmation');
      expect(JSON.stringify(share.parameters)).not.toMatch(/"OBJECT"|"STRING"/);
      expect(share.description).toContain('confirm with a button');
      for (const never of [
        'remember_fact',
        'forget_observation',
        'open_story',
        'draft_capsule',
      ]) {
        expect(CHAT_ACTION_NAMES as readonly string[]).not.toContain(never);
      }
    });

    it('does what the host asked straight away when it needs no confirming', async () => {
      const user = await createUserFixture();
      const chat = await conversation(user.id);
      const lagos = await story(user.id, 'Trip to Lagos');
      choose.mockResolvedValueOnce([
        {name: 'bookmark_story', arguments: {query: 'Lagos'}},
      ]);

      const result = await lookUpForChat({
        userId: user.id,
        memoryId: String(chat._id),
        origin: ORIGIN,
        text: 'bookmark my Lagos story',
        history: [],
      });

      expect(result.context).toContain('[bookmark_story: done]');
      expect(result.confirmations).toEqual([]);
      expect(
        await Bookmark.exists({user: user.id, memory: String(lagos._id)}),
      ).toBeTruthy();
    });

    it('turns a confirmed action into a card, and runs it once from the Confirm button', async () => {
      const user = await createUserFixture();
      const chat = await conversation(user.id);
      const lagos = await story(user.id, 'Trip to Lagos');
      choose.mockResolvedValueOnce([
        {
          name: 'delete_story',
          arguments: {query: 'Lagos', confirmation: 'AAAAAAAA'},
        },
      ]);

      const result = await lookUpForChat({
        userId: user.id,
        memoryId: String(chat._id),
        origin: ORIGIN,
        text: 'delete my Lagos story',
        history: [],
      });

      expect(result.context).toContain('waiting for the host to confirm');
      expect(result.context).toContain('Never say it is done');
      expect(await Memory.findById(lagos._id).lean()).toMatchObject({
        status: 'save',
      });
      const [card] = result.confirmations;
      expect(card).toMatchObject({
        tool: 'delete_story',
        memory: String(chat._id),
        text: 'Delete the story "Trip to Lagos".',
      });
      const reply = await Message.create({
        user: user.id,
        memory: String(chat._id),
        role: 'ai',
        text: `Shall I?\n\n\`\`\`memento-confirm\n${JSON.stringify(card)}\n\`\`\``,
      });
      expect(card.args.confirmation).toMatch(/^[A-Z2-7]{8}$/);
      expect(card.args.confirmation).not.toBe('AAAAAAAA');

      const confirmed = await confirmChatAction(
        user.id,
        card.tool,
        card.args,
        String(chat._id),
      );
      expect(confirmed.data.done).toBe(true);
      expect(confirmed.data.text).toBe(
        'Done: deleted the story "Trip to Lagos".',
      );
      expect((await Memory.findById(lagos._id).lean())?.status).toBe('deleted');

      expect((await Message.findById(reply._id).lean())?.text).toContain(
        '```memento-confirmed\n',
      );

      const again = await confirmChatAction(
        user.id,
        card.tool,
        card.args,
        String(chat._id),
      );
      expect(again.data.message).toBeNull();
      expect(
        await Message.countDocuments({memory: String(chat._id), role: 'ai'}),
      ).toBe(2);
    });

    it("will not confirm with changed details, a made-up code, or in someone else's chat", async () => {
      const user = await createUserFixture();
      const other = await createUserFixture();
      const chat = await conversation(user.id);
      await story(user.id, 'Trip to Lagos');
      await story(user.id, 'Diary');
      choose.mockResolvedValueOnce([
        {name: 'delete_story', arguments: {query: 'Lagos'}},
      ]);
      const {
        confirmations: [card],
      } = await lookUpForChat({
        userId: user.id,
        memoryId: String(chat._id),
        origin: ORIGIN,
        text: 'delete my Lagos story',
        history: [],
      });

      await expect(
        confirmChatAction(
          user.id,
          'delete_story',
          {...card.args, query: 'Diary'},
          String(chat._id),
        ),
      ).rejects.toMatchObject({statusCode: 409});
      await expect(
        confirmChatAction(
          user.id,
          'delete_story',
          {query: 'Lagos', confirmation: 'AAAAAAAA'},
          String(chat._id),
        ),
      ).rejects.toMatchObject({statusCode: 409});
      await expect(
        confirmChatAction(
          other.id,
          'delete_story',
          card.args,
          String(chat._id),
        ),
      ).rejects.toBeTruthy();
      await expect(
        confirmChatAction(
          user.id,
          'delete_account',
          card.args,
          String(chat._id),
        ),
      ).rejects.toMatchObject({statusCode: 404});
      expect(
        await Memory.countDocuments({user: user.id, status: 'deleted'}),
      ).toBe(0);
    });
  });
});
