import request from 'supertest';
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';

vi.mock('../../src/services/queues/insights', () => ({
  addToInsightsBuffer: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/module/api/ai/utils', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/module/api/ai/utils')>()),
  updateMemoryTitle: vi.fn().mockResolvedValue(undefined),
}));

import {addToInsightsBuffer} from '../../src/services/queues/insights';
import Memory from '../../src/module/database/model/memory';
import Message from '../../src/module/database/model/message';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';
import {createTestApp} from '../helpers/app';
import {createUserFixture, issueLegacyAccessToken} from '../helpers/factories';

async function setup() {
  const user = await createUserFixture();
  const token = issueLegacyAccessToken(user);
  const memory = await Memory.create({
    user: user.id,
    type: 'conversation',
    status: 'save',
    title: 'Chat',
    message_count: 4,
    last_summarized_at: new Date(Date.now() - 60_000),
  });
  return {user, token, memory};
}

const turns = [
  {index: 0, role: 'user', text: 'I finally called my brother after two years'},
  {
    index: 1,
    role: 'ai',
    text: 'How did it feel to hear his voice?',
    interrupted: true,
  },
];

describe('POST /ai/voice/turns', () => {
  beforeAll(connectTestDatabase);
  afterEach(async () => {
    vi.mocked(addToInsightsBuffer).mockClear();
    await clearTestDatabase();
  });
  afterAll(closeTestDatabase);

  it('stores each turn as its own voice message and updates activity', async () => {
    const {token, memory} = await setup();

    const res = await request(createTestApp())
      .post('/ai/voice/turns')
      .set('Authorization', `Bearer ${token}`)
      .send({session_id: 'call-1', memory_id: memory.id, turns});

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      memory_id: memory.id,
      inserted: 2,
      duplicates: 0,
    });

    const stored = await Message.find({memory: memory.id})
      .sort({voice_turn_index: 1})
      .lean();
    expect(stored.map(m => [m.role, m.text, m.is_voice])).toEqual([
      ['user', turns[0].text, true],
      ['ai', turns[1].text, true],
    ]);

    const updated = await Memory.findById(memory.id).lean();
    expect(updated?.message_count).toBe(6);
    expect(new Date(updated!.last_active!).getTime()).toBeGreaterThan(
      new Date(updated!.last_summarized_at as any).getTime(),
    );
    // Insights wait for post-call transcript clean-up.
    expect(addToInsightsBuffer).not.toHaveBeenCalled();
  });

  it('is idempotent when the client retries the same turns', async () => {
    const {token, memory} = await setup();
    const send = () =>
      request(createTestApp())
        .post('/ai/voice/turns')
        .set('Authorization', `Bearer ${token}`)
        .send({session_id: 'call-1', memory_id: memory.id, turns});

    await send();
    const retry = await send();

    expect(retry.body.data).toMatchObject({inserted: 0, duplicates: 2});
    expect(await Message.countDocuments({memory: memory.id})).toBe(2);
    expect((await Memory.findById(memory.id).lean())?.message_count).toBe(6);
  });

  it('creates a conversation by session when no memory is given', async () => {
    const {token} = await setup();

    const res = await request(createTestApp())
      .post('/ai/voice/turns')
      .set('Authorization', `Bearer ${token}`)
      .send({session_id: 'call-new', turns: [turns[0]]});

    expect(res.status).toBe(200);
    const created = await Memory.findById(res.body.data.memory_id).lean();
    expect(created?.session_id).toBe('call-new');
    expect(created?.type).toBe('conversation');
  });

  it("rejects another user's memory", async () => {
    const {memory} = await setup();
    const intruder = await createUserFixture();

    const res = await request(createTestApp())
      .post('/ai/voice/turns')
      .set('Authorization', `Bearer ${issueLegacyAccessToken(intruder)}`)
      .send({session_id: 'x', memory_id: memory.id, turns});

    expect(res.status).toBe(404);
    expect(await Message.countDocuments()).toBe(0);
  });

  it.each([
    [{session_id: 'x', turns: []}],
    [{session_id: 'x', turns: [{index: 0, role: 'user', text: '   '}]}],
    [{session_id: 'x', turns: [{index: -1, role: 'user', text: 'hi'}]}],
    [{session_id: '', turns: [{index: 0, role: 'user', text: 'hi'}]}],
  ])('rejects invalid payload %#', async body => {
    const {token} = await setup();

    const res = await request(createTestApp())
      .post('/ai/voice/turns')
      .set('Authorization', `Bearer ${token}`)
      .send(body);

    expect(res.status).toBe(422);
  });
});
