import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';

// Capture the job handler instead of starting a real BullMQ worker.
let processJob: (job: {data: unknown}) => Promise<void>;
vi.mock('bullmq', () => ({
  Worker: class {
    constructor(_name: string, handler: typeof processJob) {
      processJob = handler;
    }
  },
}));
vi.mock('../../src/services/ai/nonstream-fallback', () => ({
  generateTextWithProviderFallback: vi.fn(),
}));
vi.mock('../../src/services/account-purge/account-state', () => ({
  isActiveAccount: vi.fn().mockResolvedValue(true),
}));
vi.mock('../../src/services/memory-audio-transcripts', () => ({
  transcribeMemoryAudio: vi.fn().mockResolvedValue({text: '', recordings: 0}),
}));
vi.mock('../../src/services/queues/insights', () => ({
  queueStoryInsights: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/services/queues/summarization', () => ({
  queueSummarization: vi.fn().mockResolvedValue(undefined),
}));

import Memory from '../../src/module/database/model/memory';
import {generateTextWithProviderFallback} from '../../src/services/ai/nonstream-fallback';
import {transcribeMemoryAudio} from '../../src/services/memory-audio-transcripts';
import {queueStoryInsights} from '../../src/services/queues/insights';
import startQuickCaptureWorker from '../../src/workers/quick-capture';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';
import {createUserFixture} from '../helpers/factories';

const BODY = [
  '<p><strong>Memento</strong> How was your weekend?</p>',
  '<p><strong>You</strong> I taught my daughter to ride her bike in the park.</p>',
].join('\n');

async function voiceCall(title = 'Conversation with Memento · Nov 18, 2026') {
  const user = await createUserFixture();
  const memory = await Memory.create({
    title,
    user: user.id,
    body: BODY,
    status: 'save',
    type: 'story',
    capture_source: 'voice_call',
    tags: [],
    level: 1,
  });
  return {userId: user.id as string, memoryId: memory.id as string};
}

function aiReturns(title: string) {
  vi.mocked(generateTextWithProviderFallback).mockResolvedValue({
    text: JSON.stringify({title, tags: ['family'], category: 'family'}),
  } as never);
}

describe('quick capture worker: saved voice calls', () => {
  beforeAll(async () => {
    await connectTestDatabase();
    startQuickCaptureWorker({} as never);
  });
  afterEach(async () => {
    vi.clearAllMocks();
    await clearTestDatabase();
  });
  afterAll(closeTestDatabase);

  it('names the call after what the member talked about, from the transcript in the body', async () => {
    const {userId, memoryId} = await voiceCall();
    aiReturns('Teaching my daughter to ride a bike');

    await processJob({data: {user_id: userId, memory_id: memoryId}});

    const memory = await Memory.findById(memoryId).lean();
    expect(memory!.title).toBe('Teaching my daughter to ride a bike');
    const prompt = vi.mocked(generateTextWithProviderFallback).mock.calls[0][0]
      .messages[1].content as string;
    expect(prompt).toContain(
      'Memento: How was your weekend?\nYou: I taught my daughter',
    );
    // The body is already the transcript, and the call's turns feed insights directly.
    expect(transcribeMemoryAudio).not.toHaveBeenCalled();
    expect(queueStoryInsights).not.toHaveBeenCalled();
  });

  it('keeps the placeholder rather than a generic or empty title', async () => {
    for (const generic of ['Conversation with Memento', 'Voice note', '']) {
      const {userId, memoryId} = await voiceCall();
      aiReturns(generic);
      await processJob({data: {user_id: userId, memory_id: memoryId}});
      expect((await Memory.findById(memoryId).lean())!.title).toBe(
        'Conversation with Memento · Nov 18, 2026',
      );
    }
  });

  it('never replaces a title the member wrote', async () => {
    const {userId, memoryId} = await voiceCall('Bike day');
    aiReturns('Teaching my daughter to ride a bike');
    await processJob({data: {user_id: userId, memory_id: memoryId}});
    expect((await Memory.findById(memoryId).lean())!.title).toBe('Bike day');
  });
});
