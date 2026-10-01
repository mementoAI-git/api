import request from 'supertest';
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';

vi.mock('../../src/module/api/ai/voice/text-generator', () => ({
  generateVoiceJson: vi.fn(),
}));
vi.mock('../../src/services/queues/insights', () => ({
  addToInsightsBuffer: vi.fn().mockResolvedValue(undefined),
}));

import {generateVoiceJson} from '../../src/module/api/ai/voice/text-generator';
import Memory from '../../src/module/database/model/memory';
import Message from '../../src/module/database/model/message';
import VoiceCall from '../../src/module/database/model/voice-call';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';
import {createTestApp} from '../helpers/app';
import {createUserFixture, issueLegacyAccessToken} from '../helpers/factories';

const generate = vi.mocked(generateVoiceJson);

async function setup() {
  const user = await createUserFixture();
  const token = issueLegacyAccessToken(user);
  const memory = await Memory.create({
    user: user.id,
    type: 'conversation',
    status: 'save',
    title: 'Chat',
  });
  await Message.insertMany(
    [
      ['user', 'I finally called my brother after two years'],
      ['ai', 'How did it feel to hear his voice?'],
    ].map(([role, text], index) => ({
      user: user.id,
      memory: memory.id,
      role,
      text,
      is_voice: true,
      duration: 0,
      voice_session_id: 'call-1',
      voice_turn_index: index,
    })),
  );
  return {user, token, memory};
}

async function waitForCleanup(sessionId: string) {
  for (let i = 0; i < 50; i += 1) {
    const call = await VoiceCall.findOne({session_id: sessionId}).lean();
    if (call && !['pending', 'running'].includes(call.cleanup_status)) {
      return call;
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('clean-up did not finish');
}

describe('voice call endpoints', () => {
  beforeAll(connectTestDatabase);
  afterEach(async () => {
    generate.mockReset();
    await clearTestDatabase();
  });
  afterAll(closeTestDatabase);

  describe('POST /ai/voice/calls/:sessionId/end', () => {
    it('saves the real duration and cleans the transcript', async () => {
      const {token, memory} = await setup();
      generate.mockResolvedValue('{"fixes":[]}');

      const res = await request(createTestApp())
        .post('/ai/voice/calls/call-1/end')
        .set('Authorization', `Bearer ${token}`)
        .send({memory_id: memory.id, duration_seconds: 125.4});

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        session_id: 'call-1',
        memory_id: memory.id,
        duration_seconds: 125,
        cleanup_status: 'pending',
      });
      const durations = await Message.find({voice_session_id: 'call-1'})
        .select('duration')
        .lean();
      expect(durations.map(m => m.duration)).toEqual([125, 125]);

      const call = await waitForCleanup('call-1');
      expect(call).toMatchObject({
        cleanup_status: 'done',
        duration_seconds: 125,
        memory: memory.id,
      });
    });

    it('finds the conversation by session when no memory is given', async () => {
      const {token, memory} = await setup();
      generate.mockResolvedValue('{"fixes":[]}');

      const res = await request(createTestApp())
        .post('/ai/voice/calls/call-1/end')
        .set('Authorization', `Bearer ${token}`)
        .send({duration_seconds: 30});

      expect(res.body.data.memory_id).toBe(memory.id);
      await waitForCleanup('call-1');
    });

    it('skips clean-up for a call with no saved turns', async () => {
      const {token} = await setup();

      const res = await request(createTestApp())
        .post('/ai/voice/calls/empty-call/end')
        .set('Authorization', `Bearer ${token}`)
        .send({duration_seconds: 4});

      expect(res.body.data).toMatchObject({
        memory_id: null,
        cleanup_status: 'skipped',
      });
      expect(generate).not.toHaveBeenCalled();
    });

    it.each([
      [{}],
      [{duration_seconds: -1}],
      [{duration_seconds: 'long'}],
      [{duration_seconds: 10, memory_id: 'nope'}],
    ])('rejects invalid payload %#', async body => {
      const {token} = await setup();
      const res = await request(createTestApp())
        .post('/ai/voice/calls/call-1/end')
        .set('Authorization', `Bearer ${token}`)
        .send(body);
      expect(res.status).toBe(422);
    });

    it('requires authentication', async () => {
      const res = await request(createTestApp())
        .post('/ai/voice/calls/call-1/end')
        .send({duration_seconds: 10});
      expect(res.status).toBe(401);
    });
  });

  describe('POST /ai/voice/calls/:sessionId/summary', () => {
    const summaryAnswer = JSON.stringify({
      summary: 'You talked about calling your brother after two years.',
      key_points: ['Called your brother', 'Two years apart'],
    });

    it('cleans, summarizes and saves on first request, then reuses it', async () => {
      const {token} = await setup();
      generate.mockImplementation(async task =>
        task === 'voice_transcript_cleanup' ? '{"fixes":[]}' : summaryAnswer,
      );
      const post = () =>
        request(createTestApp())
          .post('/ai/voice/calls/call-1/summary')
          .set('Authorization', `Bearer ${token}`)
          .send();

      const first = await post();
      expect(first.status).toBe(200);
      expect(first.body.data.summary).toMatchObject({
        text: 'You talked about calling your brother after two years.',
        key_points: ['Called your brother', 'Two years apart'],
      });
      expect(generate.mock.calls.map(([task]) => task)).toEqual([
        'voice_transcript_cleanup',
        'voice_call_summary',
      ]);

      const second = await post();
      expect(second.body.data.summary.text).toBe(first.body.data.summary.text);
      expect(generate).toHaveBeenCalledTimes(2);

      const call = await VoiceCall.findOne({session_id: 'call-1'}).lean();
      expect(call).toMatchObject({
        cleanup_status: 'done',
        queue_insights: false,
      });
      expect(call?.summary?.prompt_version).toBe('voice-summary-v1');
    });

    it('returns 503 and saves nothing when the model answer is invalid', async () => {
      const {token} = await setup();
      generate.mockImplementation(async task =>
        task === 'voice_transcript_cleanup' ? '{"fixes":[]}' : 'oops',
      );

      const res = await request(createTestApp())
        .post('/ai/voice/calls/call-1/summary')
        .set('Authorization', `Bearer ${token}`)
        .send();

      expect(res.status).toBe(503);
      const call = await VoiceCall.findOne({session_id: 'call-1'}).lean();
      expect(call?.summary).toBeUndefined();
    });

    it("does not reveal another user's call", async () => {
      await setup();
      const intruder = await createUserFixture();

      const res = await request(createTestApp())
        .post('/ai/voice/calls/call-1/summary')
        .set('Authorization', `Bearer ${issueLegacyAccessToken(intruder)}`)
        .send();

      expect(res.status).toBe(404);
      expect(generate).not.toHaveBeenCalled();
    });
  });
});
