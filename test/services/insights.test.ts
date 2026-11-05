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
import mongoose from 'mongoose';
import request from 'supertest';
import {createTestApp} from '../helpers/app';
import {createUserFixture, issueLegacyAccessToken} from '../helpers/factories';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';

const {generateText, provider} = vi.hoisted(() => ({
  generateText: vi.fn(),
  provider: {down: false},
}));
vi.mock('../../src/services/ai', () => ({
  default: {
    // A plain function, because Vitest fails a test when a vi.fn rejects
    // inside work the test does not await.
    generateText: async (messages: unknown) => {
      if (provider.down) throw new Error('provider down');
      return generateText(messages);
    },
  },
}));

import InsightBatch from '../../src/module/database/model/insight-batch';
import Memory from '../../src/module/database/model/memory';
import {
  getCurrentInsights,
  getInsightSources,
  INSIGHTS_PER_BATCH,
  nextRefreshDelayMs,
  parseInsightBatch,
  removeMemoryFromInsights,
} from '../../src/services/insights';

const DAY = 24 * 60 * 60 * 1000;
const userId = new mongoose.Types.ObjectId().toString();

async function seedMemories(count: number, extra = {}) {
  return Memory.create(
    Array.from({length: count}, (_, index) => ({
      user: userId,
      type: 'story',
      status: 'save',
      title: `Memory ${index + 1}`,
      body: `A story about Sunday rest ${index + 1}`,
      dimensions: ['everyday_life'],
      ...extra,
    })),
  );
}

function modelReply(...insights: object[]) {
  return JSON.stringify({insights});
}

const validInsight = {
  title: 'You protect your Sundays',
  body: 'Rest with family returns across your stories.',
  categories: ['everyday_life', 'relationships_people'],
  memory_refs: ['M1', 'M2'],
};

async function settled() {
  await vi.waitFor(async () => {
    const batch = await InsightBatch.findOne({user: userId}).lean();
    expect(batch?.generating_until ?? null).toBeNull();
  });
}

describe('rotating insights', () => {
  beforeAll(async () => {
    await connectTestDatabase();
    // The generation lease depends on the unique user index.
    await InsightBatch.init();
  });
  beforeEach(() => {
    generateText.mockReset();
    provider.down = false;
  });
  afterEach(clearTestDatabase);
  afterAll(closeTestDatabase);

  it('waits for enough memories before generating anything', async () => {
    await seedMemories(2);

    const result = await getCurrentInsights(userId);

    expect(result).toMatchObject({insights: [], generating: false});
    expect(generateText).not.toHaveBeenCalled();
    expect(await InsightBatch.countDocuments()).toBe(0);
  });

  it('generates in the background and schedules the next batch 3 to 5 days out', async () => {
    await seedMemories(3);
    generateText.mockResolvedValue(modelReply(validInsight));

    expect((await getCurrentInsights(userId)).generating).toBe(true);
    await settled();

    const result = await getCurrentInsights(userId);
    expect(result.generating).toBe(false);
    expect(result.insights).toEqual([
      expect.objectContaining({
        title: validInsight.title,
        categories: validInsight.categories,
        source_count: 2,
      }),
    ]);
    const days =
      (new Date(result.next_refresh_at!).getTime() -
        new Date(result.generated_at!).getTime()) /
      DAY;
    expect(days).toBeGreaterThanOrEqual(3);
    expect(days).toBeLessThanOrEqual(5);
  });

  it('keeps the same batch and skips the model until a refresh is due', async () => {
    await seedMemories(3);
    generateText.mockResolvedValue(modelReply(validInsight));
    await getCurrentInsights(userId);
    await settled();
    generateText.mockClear();

    await getCurrentInsights(userId);

    expect(generateText).not.toHaveBeenCalled();
  });

  it('only starts one generation for concurrent readers', async () => {
    await seedMemories(3);
    generateText.mockResolvedValue(modelReply(validInsight));

    await Promise.all(
      Array.from({length: 5}, () => getCurrentInsights(userId)),
    );
    await settled();

    expect(generateText).toHaveBeenCalledTimes(1);
  });

  it('replaces a due batch and tells the model what was already shown', async () => {
    await seedMemories(3);
    generateText.mockResolvedValue(modelReply(validInsight));
    await getCurrentInsights(userId);
    await settled();
    await InsightBatch.updateOne(
      {user: userId},
      {
        generated_at: new Date(Date.now() - 4 * DAY),
        next_refresh_at: new Date(0),
      },
    );
    generateText.mockResolvedValue(
      modelReply({...validInsight, title: 'You keep returning to rest'}),
    );

    await getCurrentInsights(userId);
    await settled();

    const prompt = generateText.mock.lastCall![0][0].content as string;
    expect(prompt).toContain('You protect your Sundays');
  });

  it('does not spend a model call when nothing new has been added', async () => {
    await seedMemories(3);
    generateText.mockResolvedValue(modelReply(validInsight));
    await getCurrentInsights(userId);
    await settled();
    generateText.mockClear();
    await InsightBatch.updateOne(
      {user: userId},
      {generated_at: new Date(Date.now() + DAY), next_refresh_at: new Date(0)},
    );

    await getCurrentInsights(userId);
    await settled();

    expect(generateText).not.toHaveBeenCalled();
    const batch = await InsightBatch.findOne({user: userId}).lean();
    expect(batch!.insights).toHaveLength(1);
    expect(batch!.next_refresh_at.getTime()).toBeGreaterThan(Date.now());
  });

  it('keeps the current batch and backs off when generation fails', async () => {
    await seedMemories(3);
    generateText.mockResolvedValue(modelReply(validInsight));
    await getCurrentInsights(userId);
    await settled();
    await InsightBatch.updateOne(
      {user: userId},
      {
        generated_at: new Date(Date.now() - 4 * DAY),
        next_refresh_at: new Date(0),
      },
    );
    provider.down = true;

    await getCurrentInsights(userId);
    await settled();

    const result = await getCurrentInsights(userId);
    expect(result.insights).toHaveLength(1);
    expect(result.generating).toBe(false);
    expect(new Date(result.next_refresh_at!).getTime()).toBeGreaterThan(
      Date.now(),
    );
  });

  it('returns the sources for an insight without exposing other members', async () => {
    const memories = await seedMemories(3);
    generateText.mockResolvedValue(modelReply(validInsight));
    await getCurrentInsights(userId);
    await settled();
    const {insights} = await getCurrentInsights(userId);

    const {sources} = await getInsightSources(userId, {
      insight: insights[0].id,
    });

    expect(sources.map(source => source.id).sort()).toEqual(
      memories
        .map(memory => String(memory._id))
        .filter(id => sources.some(source => source.id === id))
        .sort(),
    );
    expect(sources).toHaveLength(2);
    await expect(
      getInsightSources(new mongoose.Types.ObjectId().toString(), {
        insight: insights[0].id,
      }),
    ).rejects.toThrow('Insight not found');
  });

  it('lists every memory tagged with an enrichment field', async () => {
    await seedMemories(2);
    await seedMemories(1, {dimensions: [], tags: ['heritage_roots']});
    await seedMemories(1, {dimensions: ['heritage_roots'], status: 'deleted'});

    const {sources} = await getInsightSources(userId, {
      category: 'heritage_roots',
    });

    expect(sources).toHaveLength(1);
  });

  it('hides an insight once its memories are removed', async () => {
    const memories = await seedMemories(3);
    generateText.mockResolvedValue(
      modelReply({...validInsight, memory_refs: ['M1', 'M2', 'M3']}),
    );
    await getCurrentInsights(userId);
    await settled();

    await Promise.all(
      memories.map(memory => removeMemoryFromInsights(String(memory._id))),
    );

    expect((await getCurrentInsights(userId)).insights).toEqual([]);
  });
});

describe('parseInsightBatch', () => {
  const refs = new Map([
    ['M1', 'a'],
    ['M2', 'b'],
  ]);

  it('drops unsupported, invented, and excess insights', () => {
    const raw = modelReply(
      {...validInsight, memory_refs: ['M1']},
      {...validInsight, memory_refs: ['M1', 'M99']},
      {...validInsight, categories: ['not_a_field']},
      ...Array.from({length: 6}, () => validInsight),
    );

    const parsed = parseInsightBatch(raw, refs);

    expect(parsed).toHaveLength(INSIGHTS_PER_BATCH);
    expect(parsed[0].memories).toEqual(['a', 'b']);
  });

  it('keeps every related field and removes long dashes', () => {
    const [parsed] = parseInsightBatch(
      modelReply({...validInsight, title: 'Rest — always'}),
      refs,
    );

    expect(parsed.categories).toEqual(validInsight.categories);
    expect(parsed.title).toBe('Rest , always');
  });

  it('returns nothing for malformed output', () => {
    expect(parseInsightBatch('not json', refs)).toEqual([]);
  });
});

describe('nextRefreshDelayMs', () => {
  it.each([
    [0, 3],
    [0.5, 4],
    [0.999, 5],
  ])('maps %d to %d days', (random, days) => {
    expect(nextRefreshDelayMs(() => random)).toBe(days * DAY);
  });
});

describe('insight routes', () => {
  beforeAll(connectTestDatabase);
  afterEach(clearTestDatabase);
  afterAll(closeTestDatabase);

  async function member() {
    const user = await createUserFixture();
    return {
      user,
      auth: {Authorization: `Bearer ${issueLegacyAccessToken(user)}`},
    };
  }

  it('requires authentication', async () => {
    await request(createTestApp()).get('/users/insights').expect(401);
  });

  it('returns the current insights over HTTP', async () => {
    const {auth} = await member();

    const response = await request(createTestApp())
      .get('/users/insights')
      .set(auth)
      .expect(200);

    expect(response.body.data).toMatchObject({
      insights: [],
      generating: false,
      generated_at: null,
    });
  });

  it('lists sources for a field over HTTP', async () => {
    const {user, auth} = await member();
    await Memory.create({
      user: user.id,
      type: 'story',
      status: 'save',
      title: 'Where I come from',
      body: 'Lagos',
      dimensions: ['heritage_roots'],
    });

    const response = await request(createTestApp())
      .get('/users/insights/sources?category=heritage_roots')
      .set(auth)
      .expect(200);

    expect(response.body.data.sources).toEqual([
      expect.objectContaining({title: 'Where I come from', type: 'story'}),
    ]);
  });

  it.each([
    ['neither selector', ''],
    ['both selectors', `?category=heritage_roots&insight=${'a'.repeat(24)}`],
    ['an unknown field', '?category=not_a_field'],
    ['a malformed insight id', '?insight=abc'],
  ])('rejects %s', async (_name, search) => {
    const {auth} = await member();
    await request(createTestApp())
      .get(`/users/insights/sources${search}`)
      .set(auth)
      .expect(422);
  });

  it('returns 404 for an insight the member does not have', async () => {
    const {auth} = await member();
    await request(createTestApp())
      .get(`/users/insights/sources?insight=${'a'.repeat(24)}`)
      .set(auth)
      .expect(404);
  });
});
