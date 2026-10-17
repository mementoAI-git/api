import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';
import {createUserFixture} from '../helpers/factories';
import Memory from '../../src/module/database/model/memory';
import {indexMemory} from '../../src/services/memory-search/indexing';
import {embedInputs, embedQuery} from '../../src/services/memory-search/engine';
import {
  forgetRecallCollection,
  recallWithDescriptions,
} from '../../src/services/memory-search/recall';
import {getLongTermContext} from '../../src/services/embeddings/long-term';
import {forgetUserContext} from '../../src/services/user-context-cache';

vi.mock('../../src/services/memory-search/engine', () => ({
  embedInputs: vi.fn(),
  embedQuery: vi.fn(),
}));
vi.mock('../../src/services/queues/memory-search', () => ({
  queueMemorySearch: vi.fn(async () => true),
}));
vi.mock('../../src/services/embeddings/search', () => ({
  semanticSearch: vi.fn(async () => [
    {source: 'story', text: 'from the local model', written_at: undefined},
  ]),
}));

/** One axis per meaning: the visa story sits on axis 0, the dog story on 1. */
const axis = (i: number) =>
  Array.from({length: 768}, (_, j) => (j === i ? 1 : 0));

describe('recall from the description-search index', () => {
  beforeAll(connectTestDatabase);
  afterAll(closeTestDatabase);
  afterEach(async () => {
    vi.unstubAllEnvs();
    await clearTestDatabase();
  });
  beforeEach(() => {
    vi.mocked(embedInputs).mockImplementation(async batches =>
      batches.map(batch =>
        batch.inputs.map(input => (input.includes('visa') ? axis(0) : axis(1))),
      ),
    );
    vi.mocked(embedQuery).mockResolvedValue(axis(0));
  });

  async function setup(pilot = true) {
    const owner = await createUserFixture();
    forgetRecallCollection(owner.id);
    if (pilot) {
      vi.stubEnv('MEMORY_SEARCH_ENABLED', 'true');
      vi.stubEnv('MEMORY_SEARCH_USER_IDS', owner.id);
      vi.stubEnv('MEMORY_SEARCH_DIGUP_PATH', '/trial/digup');
      vi.stubEnv('MEMORY_SEARCH_MODELS_DIR', '/trial/models');
    }
    const visa = await Memory.create({
      user: owner.id,
      title: 'Emeka abroad',
      body: 'Emeka finally got his visa and flew to Toronto in the rain.',
      type: 'story',
      status: 'save',
    });
    const dog = await Memory.create({
      user: owner.id,
      title: 'Bingo',
      body: 'Our dog Bingo chased the chickens every morning.',
      type: 'story',
      status: 'save',
    });
    if (pilot) {
      expect(await indexMemory(owner.id, visa.id)).toBe(true);
      expect(await indexMemory(owner.id, dog.id)).toBe(true);
    }
    return {owner, visa, dog};
  }

  it('finds the story by meaning and quotes its own words', async () => {
    const {owner, visa} = await setup();
    const matches = await recallWithDescriptions(
      owner.id,
      'my brother moving abroad',
    );

    expect(matches?.map(match => match.memory)).toEqual([visa.id]);
    expect(matches?.[0].text).toContain('Emeka finally got his visa');
    expect(matches?.[0].text).not.toContain('title:');
  });

  it('is null outside the pilot, so the caller falls back', async () => {
    const {owner} = await setup(false);
    expect(await recallWithDescriptions(owner.id, 'my brother')).toBeNull();
    expect(await getLongTermContext(owner.id, 'my brother')).toContain(
      'from the local model',
    );
  });

  it('is null when the embedding server fails', async () => {
    const {owner} = await setup();
    vi.mocked(embedQuery).mockRejectedValueOnce(new Error('down'));
    expect(await recallWithDescriptions(owner.id, 'my brother')).toBeNull();
  });

  it('voice and chat context use it when it is available', async () => {
    const {owner} = await setup();
    const context = await getLongTermContext(
      owner.id,
      'my brother moving abroad',
    );
    expect(context).toContain('Emeka abroad: Emeka finally got his visa');
    expect(context).not.toContain('from the local model');
  });

  it('a deleted story is not recalled once the app forgets its context', async () => {
    const {owner, visa} = await setup();
    await recallWithDescriptions(owner.id, 'my brother');
    await Memory.updateOne({_id: visa.id}, {$set: {status: 'deleted'}});
    await forgetUserContext(owner.id);

    const matches = await recallWithDescriptions(
      owner.id,
      'my brother moving abroad',
    );
    expect(matches?.map(match => match.memory)).not.toContain(visa.id);
  });
});
