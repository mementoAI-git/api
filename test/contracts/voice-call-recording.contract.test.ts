import request from 'supertest';
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';

// Mock heavy async side effects that fire from createMemory so tests stay fast
// and isolated.  We only need to verify that the endpoint wires them up — not
// that the queues themselves work.
vi.mock('../../src/module/api/user/service', async original => ({
  ...(await original<typeof import('../../src/module/api/user/service')>()),
  updateStreak: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/services/enrichment', async original => ({
  ...(await original<typeof import('../../src/services/enrichment')>()),
  invalidateEnrichmentCache: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/services/queues/memory-search', () => ({
  queueMemorySearch: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/services/queues/insights', () => ({
  queueStoryInsights: vi.fn().mockResolvedValue(undefined),
  flushBufferNow: vi.fn().mockResolvedValue(undefined),
  addToInsightsBuffer: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/services/queues/summarization', () => ({
  queueSummarization: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/services/queues/quick-capture', () => ({
  queueQuickCaptureEnrichment: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/services/growth-events', () => ({
  memoryCaptured: vi.fn().mockResolvedValue(undefined),
  memoryShared: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/module/api/activity/service', () => ({
  track: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/services/user-context-cache', () => ({
  forgetUserContext: vi.fn().mockResolvedValue(undefined),
}));

import File from '../../src/module/database/model/file';
import Memory from '../../src/module/database/model/memory';
import VoiceCall from '../../src/module/database/model/voice-call';
import {queueStoryInsights} from '../../src/services/queues/insights';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';
import {createTestApp} from '../helpers/app';
import {createUserFixture, issueLegacyAccessToken} from '../helpers/factories';

const SEGMENTS = [
  {start: 0, end: 3.5, text: 'Tell me about your day.', speaker: 'ai' as const},
  {
    start: 4,
    end: 8,
    text: 'It was great, I went for a walk.',
    speaker: 'user' as const,
  },
];

async function setup() {
  const user = await createUserFixture();
  const token = issueLegacyAccessToken(user);
  const audioFile = await File.create({
    user: user.id,
    name: `voice-${user.id}.webm`,
    type: 'audio/webm',
    size: 48_000,
    provider: 's3',
  });
  return {user, token, audioFile};
}

describe('POST /ai/voice/calls/:sessionId/recording', () => {
  beforeAll(connectTestDatabase);
  afterEach(clearTestDatabase);
  afterAll(closeTestDatabase);

  it('creates a story and returns memory_id + file_id', async () => {
    const {token, audioFile} = await setup();

    const res = await request(createTestApp())
      .post('/ai/voice/calls/sess-1/recording')
      .set('Authorization', `Bearer ${token}`)
      .send({
        file_id: audioFile.id,
        duration_seconds: 10,
        segments: SEGMENTS,
      });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      memory_id: expect.stringMatching(/^[a-f0-9]{24}$/),
      file_id: audioFile.id,
    });

    // Story should exist in DB with correct fields
    const memory = await Memory.findById(res.body.data.memory_id);
    expect(memory).not.toBeNull();
    expect(memory!.type).toBe('story');
    expect(memory!.capture_source).toBe('voice_call');
    expect(memory!.status).toBe('save');
    expect(memory!.attachments.map(String)).toContain(audioFile.id);

    // VoiceCall record should reference the file and story
    const call = await VoiceCall.findOne({session_id: 'sess-1'}).lean();
    expect(call).not.toBeNull();
    expect(String(call!.recording_file)).toBe(audioFile.id);
    expect(String(call!.story_memory)).toBe(res.body.data.memory_id);
  });

  it('writes transcription with speaker labels onto the file', async () => {
    const {token, audioFile} = await setup();

    await request(createTestApp())
      .post('/ai/voice/calls/sess-2/recording')
      .set('Authorization', `Bearer ${token}`)
      .send({
        file_id: audioFile.id,
        duration_seconds: 10,
        segments: SEGMENTS,
        speech: [
          {start: 0.2, end: 2.5},
          {start: 4, end: 9.1},
        ],
      });

    const updated = await File.findById(audioFile.id).lean();
    expect(updated!.transcription.speech).toEqual([
      {start: 0.2, end: 2.5},
      {start: 4, end: 9.1},
    ]);
    expect(updated!.duration).toBe(10);
    expect(updated!.transcription.full_text).toBe(
      'Memento: Tell me about your day.\nYou: It was great, I went for a walk.',
    );
    expect(updated!.transcription.segments).toHaveLength(2);
    expect(updated!.transcription.segments[0].speaker).toBe('ai');
    expect(updated!.transcription.segments[1].speaker).toBe('user');
  });

  it('is idempotent: a second call returns the same memory_id without changes', async () => {
    const {token, audioFile} = await setup();

    const first = await request(createTestApp())
      .post('/ai/voice/calls/sess-3/recording')
      .set('Authorization', `Bearer ${token}`)
      .send({file_id: audioFile.id, duration_seconds: 10, segments: SEGMENTS});

    const second = await request(createTestApp())
      .post('/ai/voice/calls/sess-3/recording')
      .set('Authorization', `Bearer ${token}`)
      .send({file_id: audioFile.id, duration_seconds: 10, segments: SEGMENTS});

    expect(second.status).toBe(200);
    expect(second.body.data.memory_id).toBe(first.body.data.memory_id);

    // Only one Memory should exist for this call
    expect(await Memory.countDocuments({capture_source: 'voice_call'})).toBe(1);
  });

  it('does not queue story insights (call turns feed that pipeline)', async () => {
    const {token, audioFile} = await setup();
    vi.mocked(queueStoryInsights).mockClear();

    await request(createTestApp())
      .post('/ai/voice/calls/sess-4/recording')
      .set('Authorization', `Bearer ${token}`)
      .send({file_id: audioFile.id, duration_seconds: 10, segments: SEGMENTS});

    expect(queueStoryInsights).not.toHaveBeenCalled();
  });

  it('rejects a file belonging to another user with 404', async () => {
    const {token} = await setup();
    const otherUser = await createUserFixture();
    const foreignFile = await File.create({
      user: otherUser.id,
      name: 'foreign-voice.webm',
      type: 'audio/webm',
      size: 1024,
      provider: 's3',
    });

    const res = await request(createTestApp())
      .post('/ai/voice/calls/sess-5/recording')
      .set('Authorization', `Bearer ${token}`)
      .send({
        file_id: foreignFile.id,
        duration_seconds: 5,
        segments: SEGMENTS,
      });

    expect(res.status).toBe(404);
    expect(await Memory.countDocuments({capture_source: 'voice_call'})).toBe(0);
  });

  it('rejects a non-audio file with 400', async () => {
    const {user, token} = await setup();
    const imageFile = await File.create({
      user: user.id,
      name: 'photo.jpg',
      type: 'image/jpeg',
      size: 2048,
      provider: 's3',
    });

    const res = await request(createTestApp())
      .post('/ai/voice/calls/sess-6/recording')
      .set('Authorization', `Bearer ${token}`)
      .send({
        file_id: imageFile.id,
        duration_seconds: 5,
        segments: SEGMENTS,
      });

    expect(res.status).toBe(400);
    expect(await Memory.countDocuments({capture_source: 'voice_call'})).toBe(0);
  });

  it('requires authentication', async () => {
    const {audioFile} = await setup();
    const res = await request(createTestApp())
      .post('/ai/voice/calls/sess-7/recording')
      .send({file_id: audioFile.id, duration_seconds: 10, segments: SEGMENTS});
    expect(res.status).toBe(401);
  });

  it.each([
    // missing file_id
    [{duration_seconds: 10, segments: SEGMENTS}],
    // bad file_id format
    [{file_id: 'not-an-id', duration_seconds: 10, segments: SEGMENTS}],
    // negative duration
    [
      {
        file_id: '507f1f77bcf86cd799439011',
        duration_seconds: -1,
        segments: SEGMENTS,
      },
    ],
    // extra unknown key
    [
      {
        file_id: '507f1f77bcf86cd799439011',
        duration_seconds: 10,
        segments: SEGMENTS,
        extra_field: true,
      },
    ],
    // segment with end < start
    [
      {
        file_id: '507f1f77bcf86cd799439011',
        duration_seconds: 10,
        segments: [{start: 5, end: 2, text: 'oops', speaker: 'user'}],
      },
    ],
    // segment with empty text
    [
      {
        file_id: '507f1f77bcf86cd799439011',
        duration_seconds: 10,
        segments: [{start: 0, end: 1, text: '', speaker: 'ai'}],
      },
    ],
  ])('rejects invalid payload %#', async body => {
    const {token} = await setup();
    const res = await request(createTestApp())
      .post('/ai/voice/calls/sess-dto/recording')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
    expect(res.status).toBe(422);
  });
});
