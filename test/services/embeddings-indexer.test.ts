import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';

import Memory from '../../src/module/database/model/memory';
import MemoryEmbedding from '../../src/module/database/model/memory-embedding';
import Message from '../../src/module/database/model/message';
import {setEmbedderForTests} from '../../src/services/embeddings';
import {
  indexMessages,
  indexStories,
  pruneOrphans,
} from '../../src/services/embeddings/indexer';
import {
  forgetCachedVectors,
  semanticSearch,
} from '../../src/services/embeddings/search';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';
import {createUserFixture} from '../helpers/factories';

// A stand-in for Gemini: each "concept" is a dimension, so "brother" and
// "Emeka" mean the same thing here without sharing a word.
const CONCEPTS = [
  ['brother', 'emeka', 'sibling', 'visa', 'toronto'],
  ['soup', 'kitchen', 'food', 'grandma', 'cook'],
  ['work', 'office', 'shell', 'job', 'lost'],
  ['beach', 'sea', 'lagos', 'waves', 'holiday'],
];
let embedCalls = 0;

beforeEach(() => {
  embedCalls = 0;
  setEmbedderForTests(async texts => {
    embedCalls += texts.length;
    return texts.map(text => {
      const words = text.toLowerCase();
      return CONCEPTS.map(concept =>
        concept.some(word => words.includes(word)) ? 1 : 0.01,
      );
    });
  });
});

describe('in-house memory embeddings', () => {
  beforeAll(connectTestDatabase);
  afterEach(async () => {
    await clearTestDatabase();
  });
  afterAll(async () => {
    setEmbedderForTests(null);
    await closeTestDatabase();
  });

  async function story(
    user: string,
    title: string,
    body: string,
    status = 'save',
  ) {
    return Memory.create({user, type: 'story', status, title, body});
  }

  it('finds a story by meaning, not words: "my brother" finds the one about Emeka', async () => {
    const user = await createUserFixture();
    await story(user.id, 'Big news', '<p>Emeka got his visa for Toronto!</p>');
    await story(user.id, 'Sunday', 'Grandma made soup in her kitchen.');
    await indexStories();
    forgetCachedVectors(user.id);

    const matches = await semanticSearch(
      user.id,
      'what did I say about my brother',
    );

    expect(matches[0]?.text).toContain('Emeka got his visa');
    expect(matches.map(match => match.text).join(' ')).not.toContain('Grandma');
  });

  it("only ever searches the host's own content", async () => {
    const user = await createUserFixture();
    const other = await createUserFixture();
    await story(other.id, 'Theirs', 'Emeka moved to Toronto.');
    await indexStories();

    expect(await semanticSearch(user.id, 'my brother')).toEqual([]);
  });

  it('skips drafts, and forgets a story when it is deleted', async () => {
    const user = await createUserFixture();
    await story(user.id, 'Draft', 'Emeka draft', 'draft');
    const kept = await story(user.id, 'Kept', 'Emeka visa');
    await indexStories();
    expect(await MemoryEmbedding.countDocuments({user: user.id})).toBe(1);

    await Memory.updateOne({_id: kept._id}, {status: 'deleted'});
    await indexStories();
    forgetCachedVectors(user.id);

    expect(await MemoryEmbedding.countDocuments({user: user.id})).toBe(0);
    expect(await semanticSearch(user.id, 'brother')).toEqual([]);
  });

  it('re-embeds a story only when its text changes', async () => {
    const user = await createUserFixture();
    const lagos = await story(user.id, 'Lagos', 'At the beach.');
    await indexStories();
    expect(embedCalls).toBe(1);

    await indexStories();
    expect(embedCalls).toBe(1);

    await Memory.updateOne({_id: lagos._id}, {body: 'At the beach with Ada.'});
    await indexStories();
    expect(embedCalls).toBe(2);
  });

  it("indexes the host's own lines in chats and calls, not Memento's or tiny ones", async () => {
    const user = await createUserFixture();
    const chat = await Memory.create({
      user: user.id,
      type: 'conversation',
      status: 'save',
      title: 'Chat',
    });
    await Message.create({
      user: user.id,
      memory: chat.id,
      role: 'user',
      text: 'My brother Emeka is moving to Toronto soon.',
    });
    await Message.create({
      user: user.id,
      memory: chat.id,
      role: 'ai',
      text: 'That is big news about your brother and Toronto!',
    });
    await Message.create({
      user: user.id,
      memory: chat.id,
      role: 'user',
      text: 'ok',
    });

    expect((await indexMessages()).embedded).toBe(1);
    const [match] = await semanticSearch(user.id, 'my brother');
    expect(match.text).toBe('My brother Emeka is moving to Toronto soon.');
    expect(match.source).toBe('message');
  });

  // The backfill pages with skip; without it, a host with more stories than
  // one page only ever had their first page embedded.
  it("pages through all of a host's stories, not just the first page", async () => {
    const user = await createUserFixture();
    for (const word of ['beach', 'soup', 'visa']) {
      await story(user.id, word, `About ${word}`);
    }

    const first = await indexStories({user: user.id, limit: 2, skip: 0});
    const second = await indexStories({user: user.id, limit: 2, skip: 2});

    expect([first.seen, second.seen]).toEqual([2, 1]);
    expect(first.embedded + second.embedded).toBe(3);
    expect(await MemoryEmbedding.countDocuments({user: user.id})).toBe(3);
  });

  it('removes embeddings whose story or message is gone', async () => {
    const user = await createUserFixture();
    const lagos = await story(user.id, 'Lagos', 'At the beach.');
    await indexStories();
    await Memory.deleteOne({_id: lagos._id});

    expect(await pruneOrphans()).toBe(1);
    expect(await MemoryEmbedding.countDocuments()).toBe(0);
  });
});
