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
import Message from '../../src/module/database/model/message';
import {
  applyInsightDecisions,
  getCurrentInsights,
  getInsightSources,
  insightStatus,
  MAX_ACTIVE_INSIGHTS,
  nextRefreshDelayMs,
  removeMemoryFromInsights,
  selectEvidence,
} from '../../src/services/insights';

const DAY = 24 * 60 * 60 * 1000;
const userId = new mongoose.Types.ObjectId().toString();

function daysAgo(days: number) {
  return new Date(Date.now() - days * DAY);
}

/** Stories written on separate days, oldest first. */
async function seedStories(ages: number[], extra = {}) {
  const stories = [];
  for (const [index, age] of ages.entries()) {
    const story = await Memory.create({
      user: userId,
      type: 'story',
      status: 'save',
      title: `Memory ${index + 1}`,
      body: `A story about Sunday rest ${index + 1}`,
      dimensions: ['everyday_life'],
      ...extra,
    });
    await Memory.collection.updateOne(
      {_id: story._id as never},
      {$set: {created_at: daysAgo(age), updated_at: daysAgo(age)}},
    );
    stories.push(story);
  }
  return stories;
}

function modelReply(...decisions: object[]) {
  return JSON.stringify({decisions});
}

const newInsight = {
  action: 'new',
  title: 'You protect your Sundays',
  body: 'Rest with family returns across your stories.',
  categories: ['everyday_life', 'relationships_people'],
  evidence_refs: ['E1', 'E2', 'E3'],
};

async function settled() {
  await vi.waitFor(async () => {
    const batch = await InsightBatch.findOne({user: userId}).lean();
    expect(batch?.generating_until ?? null).toBeNull();
  });
}

async function evaluate(reply: string) {
  generateText.mockResolvedValue(reply);
  await getCurrentInsights(userId);
  await settled();
  return getCurrentInsights(userId);
}

async function makeDue() {
  await InsightBatch.updateOne(
    {user: userId},
    {generated_at: daysAgo(4), next_refresh_at: new Date(0)},
  );
}

describe('evidence-driven insights', () => {
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

  it('waits for enough material before evaluating anything', async () => {
    await seedStories([30, 20]);

    const result = await getCurrentInsights(userId);

    expect(result).toMatchObject({insights: [], generating: false});
    expect(generateText).not.toHaveBeenCalled();
    expect(await InsightBatch.countDocuments()).toBe(0);
  });

  it('surfaces a supported insight and checks again in 3 to 5 days', async () => {
    await seedStories([30, 20, 5]);

    const result = await evaluate(modelReply(newInsight));

    expect(result.insights).toEqual([
      expect.objectContaining({
        title: newInsight.title,
        categories: newInsight.categories,
        source_count: 3,
        status: 'established',
      }),
    ]);
    const days =
      (new Date(result.next_refresh_at!).getTime() -
        new Date(result.generated_at!).getTime()) /
      DAY;
    expect(days).toBeGreaterThanOrEqual(3);
    expect(days).toBeLessThanOrEqual(5);
  });

  it('accepts finding nothing and waits for the normal check', async () => {
    await seedStories([30, 20, 5]);

    const result = await evaluate(modelReply());

    expect(result.insights).toEqual([]);
    expect(result.generated_at).not.toBeNull();
    expect(new Date(result.next_refresh_at!).getTime()).toBeGreaterThan(
      Date.now() + 2 * DAY,
    );
  });

  it('marks evidence over a short span as emerging', async () => {
    await seedStories([6, 4, 2]);

    const result = await evaluate(modelReply(newInsight));

    expect(result.insights[0].status).toBe('emerging');
  });

  it('skips the model until a check is due', async () => {
    await seedStories([30, 20, 5]);
    await evaluate(modelReply(newInsight));
    generateText.mockClear();

    await getCurrentInsights(userId);

    expect(generateText).not.toHaveBeenCalled();
  });

  it('only starts one evaluation for concurrent readers', async () => {
    await seedStories([30, 20, 5]);
    generateText.mockResolvedValue(modelReply(newInsight));

    await Promise.all(
      Array.from({length: 5}, () => getCurrentInsights(userId)),
    );
    await settled();

    expect(generateText).toHaveBeenCalledTimes(1);
  });

  it('does not spend a model call when nothing new has been added', async () => {
    await seedStories([30, 20, 5]);
    await evaluate(modelReply(newInsight));
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

  it('keeps an insight and its id when a later check changes nothing', async () => {
    await seedStories([30, 20, 5]);
    const before = await evaluate(modelReply(newInsight));
    await seedStories([1]);
    await makeDue();

    const after = await evaluate(modelReply());

    expect(after.insights.map(item => item.id)).toEqual(
      before.insights.map(item => item.id),
    );
  });

  it('adds evidence and revises wording while keeping the same insight', async () => {
    await seedStories([30, 20, 5]);
    const before = await evaluate(modelReply(newInsight));
    await seedStories([1]);
    await makeDue();

    const after = await evaluate(
      modelReply({
        action: 'update',
        insight: 'I1',
        title: 'Family rest anchors your week',
        evidence_refs: ['E4'],
      }),
    );

    expect(after.insights).toEqual([
      expect.objectContaining({
        id: before.insights[0].id,
        title: 'Family rest anchors your week',
        body: newInsight.body,
        source_count: 4,
      }),
    ]);
  });

  it('retires an insight and tells later checks not to repeat it', async () => {
    await seedStories([30, 20, 5]);
    await evaluate(modelReply(newInsight));
    await seedStories([1]);
    await makeDue();
    const afterRetire = await evaluate(
      modelReply({action: 'retire', insight: 'I1'}),
    );
    expect(afterRetire.insights).toEqual([]);
    await seedStories([1]);
    await makeDue();

    const again = await evaluate(modelReply(newInsight));

    const prompt = generateText.mock.lastCall![0][0].content as string;
    expect(prompt).toContain('RETIRED');
    expect(prompt).toContain(newInsight.title);
    expect(again.insights).toEqual([]);
  });

  it('keeps current insights and backs off when evaluation fails', async () => {
    await seedStories([30, 20, 5]);
    await evaluate(modelReply(newInsight));
    await seedStories([1]);
    await makeDue();
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

  it('backs off on malformed output instead of treating it as nothing found', async () => {
    await seedStories([30, 20, 5]);

    const result = await evaluate('I could not decide');

    expect(result.generated_at).toBeNull();
  });

  describe('chats as evidence', () => {
    async function seedChat(
      days: {age: number; role?: string; text: string}[],
    ) {
      const chat = await Memory.create({
        user: userId,
        type: 'conversation',
        status: 'save',
        title: 'Host chat',
        body: '',
      });
      for (const day of days) {
        const message = await Message.create({
          user: userId,
          memory: String(chat._id),
          role: day.role ?? 'user',
          text: day.text,
        });
        await Message.collection.updateOne(
          {_id: message._id as never},
          {$set: {created_at: daysAgo(day.age)}},
        );
      }
      return chat;
    }

    it('counts one chat as separate evidence for each day', async () => {
      await seedChat([
        {age: 30, text: 'Sunday lunch with my parents'},
        {age: 20, text: 'Back at my parents on Sunday'},
        {age: 5, text: 'Sunday with family again'},
      ]);

      const result = await evaluate(modelReply(newInsight));

      expect(result.insights).toEqual([
        expect.objectContaining({source_count: 3, status: 'established'}),
      ]);
      const {sources} = await getInsightSources(userId, {
        insight: result.insights[0].id,
      });
      expect(sources).toHaveLength(3);
      expect(new Set(sources.map(source => source.created_at)).size).toBe(3);
    });

    it('does not count repetition within one day as more evidence', async () => {
      await seedChat([
        {age: 3, text: 'I love Sundays'},
        {age: 3, text: 'Sundays are the best'},
        {age: 3, text: 'Really, Sundays'},
      ]);
      await seedStories([20]);

      await evaluate(modelReply());

      const prompt = generateText.mock.lastCall?.[0][0].content;
      expect(prompt).toBeUndefined();
    });

    it('only uses what the member wrote', async () => {
      await seedStories([40]);
      await seedChat([
        {age: 30, text: 'My own words'},
        {age: 30, role: 'ai', text: 'The assistant reply'},
        {age: 5, text: 'More of my words'},
      ]);

      await evaluate(modelReply());

      const prompt = generateText.mock.lastCall![0][0].content as string;
      expect(prompt).toContain('My own words');
      expect(prompt).not.toContain('The assistant reply');
    });
  });

  it('returns sources without exposing other members', async () => {
    await seedStories([30, 20, 5, 3]);
    const {insights} = await evaluate(modelReply(newInsight));

    const {sources} = await getInsightSources(userId, {
      insight: insights[0].id,
    });

    expect(sources).toHaveLength(3);
    await expect(
      getInsightSources(new mongoose.Types.ObjectId().toString(), {
        insight: insights[0].id,
      }),
    ).rejects.toThrow('Insight not found');
  });

  it('lists every memory tagged with an enrichment field', async () => {
    await seedStories([9, 8]);
    await seedStories([7], {dimensions: [], tags: ['heritage_roots']});
    await seedStories([6], {dimensions: ['heritage_roots'], status: 'deleted'});

    const {sources} = await getInsightSources(userId, {
      category: 'heritage_roots',
    });

    expect(sources).toHaveLength(1);
  });

  it('hides an insight once deleted memories leave too little evidence', async () => {
    const stories = await seedStories([30, 20, 5]);
    await evaluate(modelReply(newInsight));

    await Memory.updateOne({_id: stories[0]._id}, {status: 'deleted'});

    expect((await getCurrentInsights(userId)).insights).toEqual([]);
  });

  it('frees the slot of an insight that lost its evidence', async () => {
    const stories = await seedStories([30, 20, 5, 4, 3]);
    await evaluate(modelReply(newInsight));
    await Memory.updateOne({_id: stories[0]._id}, {status: 'deleted'});
    await makeDue();
    await Memory.updateOne({_id: stories[4]._id}, {title: 'Edited'});

    await evaluate(modelReply());

    const batch = await InsightBatch.findOne({user: userId}).lean();
    expect(batch!.insights).toEqual([]);
  });

  it('removes purged memories from the evidence', async () => {
    const stories = await seedStories([30, 20, 5]);
    await evaluate(modelReply(newInsight));

    await removeMemoryFromInsights(String(stories[0]._id));

    const batch = await InsightBatch.findOne({user: userId}).lean();
    expect(batch!.insights[0].evidence).toHaveLength(2);
  });
});

describe('applyInsightDecisions', () => {
  const now = new Date('2026-11-06T00:00:00Z');
  const evidenceByRef = new Map(
    [
      ['E1', 'a', '2026-01-01'],
      ['E2', 'b', '2026-02-01'],
      ['E3', 'c', '2026-03-01'],
      ['E4', 'd', '2026-03-01'],
      ['E5', 'e', '2026-03-01'],
      ['E6', 'f', '2026-03-01'],
    ].map(([ref, memory, date]) => [ref, {memory, date}]),
  );
  const apply = (decisions: object[], existing: never[] = []) =>
    applyInsightDecisions({
      raw: modelReply(...decisions),
      existing,
      evidenceByRef,
      retiredTitles: [],
      now,
    })!.insights;

  it.each([
    ['too few sources', {evidence_refs: ['E1', 'E2']}],
    ['all on one date', {evidence_refs: ['E3', 'E4', 'E5']}],
    ['repeats of one source', {evidence_refs: ['E1', 'E1', 'E2']}],
    ['invented evidence', {evidence_refs: ['E1', 'E2', 'E99']}],
    ['unknown fields only', {categories: ['not_a_field']}],
    ['no title', {title: ''}],
  ])('rejects a new insight with %s', (_name, change) => {
    expect(apply([{...newInsight, ...change}])).toEqual([]);
  });

  it('accepts same-day sources when another date is present', () => {
    expect(
      apply([{...newInsight, evidence_refs: ['E2', 'E3', 'E4']}]),
    ).toHaveLength(1);
  });

  it('never shows more than the maximum', () => {
    const decisions = Array.from({length: 6}, (_, index) => ({
      ...newInsight,
      title: `Different pattern ${index}`,
    }));

    expect(apply(decisions)).toHaveLength(MAX_ACTIVE_INSIGHTS);
  });

  it('rejects a repeat of the same title', () => {
    expect(
      apply([newInsight, {...newInsight, title: 'you protect your sundays!'}]),
    ).toHaveLength(1);
  });

  it('keeps fields with the strongest first and removes long dashes', () => {
    const [insight] = apply([{...newInsight, title: 'Rest — always'}]);

    expect(insight.categories).toEqual(newInsight.categories);
    expect(insight.title).toBe('Rest , always');
  });

  it('returns null for unusable output but accepts no decisions', () => {
    const input = {existing: [], evidenceByRef, retiredTitles: [], now};
    expect(applyInsightDecisions({...input, raw: 'not json'})).toBeNull();
    expect(applyInsightDecisions({...input, raw: '{"decisions":[]}'})).toEqual({
      insights: [],
      retiredTitles: [],
    });
  });
});

describe('selectEvidence', () => {
  const units = Array.from({length: 40}, (_, index) => ({
    memory: `m${index}`,
    date: `d${index}`,
    title: '',
    fields: [],
    excerpt: '',
  }));

  it('keeps everything under the limit', () => {
    expect(selectEvidence(units, 50)).toHaveLength(40);
  });

  it('keeps the newest and a spread of the oldest over the limit', () => {
    const selected = selectEvidence(units, 10);

    expect(selected).toHaveLength(10);
    expect(selected[0].memory).toBe('m0');
    expect(selected.at(-1)!.memory).toBe('m39');
    expect(selected[1].memory).not.toBe('m1');
  });
});

describe('insightStatus', () => {
  it.each([
    [13, 'emerging'],
    [14, 'established'],
  ])('treats a %d day span as %s', (days, status) => {
    const end = new Date('2026-06-01').getTime() + days * DAY;
    expect(
      insightStatus([
        {memory: 'a', date: '2026-06-01'},
        {memory: 'b', date: new Date(end).toISOString().slice(0, 10)},
      ]),
    ).toBe(status);
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
