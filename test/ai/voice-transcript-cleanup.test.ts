import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';

vi.mock('../../src/module/api/ai/voice/text-generator', () => ({
  generateVoiceJson: vi.fn(),
}));
vi.mock('../../src/services/queues/insights', () => ({
  addToInsightsBuffer: vi.fn().mockResolvedValue(undefined),
}));

import {generateVoiceJson} from '../../src/module/api/ai/voice/text-generator';
import {addToInsightsBuffer} from '../../src/services/queues/insights';
import Message from '../../src/module/database/model/message';
import VoiceCall from '../../src/module/database/model/voice-call';
import {
  buildCleanupPrompt,
  cleanVoiceCallTranscript,
  guardCleanupFix,
  loadCallTurns,
  parseCleanupResponse,
} from '../../src/module/api/ai/voice/transcript-cleanup';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';

const generate = vi.mocked(generateVoiceJson);
const userId = 'user-1';
const memoryId = 'memory-1';
const sessionId = 'call-1';

const lines: [string, string][] = [
  ['user', 'I spent every summer at my grandmother farm in Kaduna'],
  ['ai', 'A farm in Kaduna! What do you remember most about it?'],
  ['user', 'لا أعرف'],
  ['ai', 'Take your time.'],
  ['user', 'The goats, she had about twenty goats and a big mango tree'],
  ['ai', 'Twenty goats and a mango tree, that sounds lively.'],
];

async function seedCall(queueInsights = true) {
  await Message.insertMany(
    lines.map(([role, text], index) => ({
      user: userId,
      memory: memoryId,
      role,
      text,
      is_voice: true,
      voice_session_id: sessionId,
      voice_turn_index: index,
    })),
  );
  await VoiceCall.create({
    user: userId,
    memory: memoryId,
    session_id: sessionId,
    cleanup_status: 'pending',
    queue_insights: queueInsights,
  });
}

describe('parseCleanupResponse', () => {
  const userIndexes = new Set([0, 2, 4]);

  it('keeps valid fixes for Host lines only', () => {
    const raw = JSON.stringify({
      fixes: [
        {index: 2, text: ' [unclear] '},
        {index: 1, text: 'Memento lines are never changed'},
        {index: 9, text: 'unknown line'},
        {index: 4, text: ''},
        {index: '0', text: 'string index'},
      ],
    });
    expect(parseCleanupResponse(raw, userIndexes)).toEqual([
      {index: 2, text: '[unclear]'},
    ]);
  });

  it('accepts fenced JSON and an empty fix list', () => {
    expect(
      parseCleanupResponse('```json\n{"fixes":[]}\n```', userIndexes),
    ).toEqual([]);
  });

  it.each(['not json', '{"changes":[]}', '{"fixes":"none"}', ''])(
    'returns null for an invalid answer %#',
    raw => {
      expect(parseCleanupResponse(raw, userIndexes)).toBeNull();
    },
  );
});

describe('guardCleanupFix', () => {
  it('keeps a correction of how words were heard', () => {
    expect(
      guardCleanupFix(
        'I was thinking about my grand mothers farm in kaduna',
        "I was thinking about my grandmother's farm in Kaduna",
      ),
    ).toBe("I was thinking about my grandmother's farm in Kaduna");
    expect(
      guardCleanupFix(
        'wen I was young we lived there',
        'when I was young we lived there',
      ),
    ).toBe('when I was young we lived there');
  });

  // Memento's reply is not evidence of what the Host said. A fix that swaps
  // in a different person, place, number or negation would put words in the
  // Host's mouth and then into their lasting personal context.
  it('keeps what was heard when a fix swaps in a different place or person', () => {
    expect(
      guardCleanupFix(
        'I visited Lagos with my aunt',
        'I visited Abuja with my aunt',
      ),
    ).toBe('I visited Lagos with my aunt');
    expect(
      guardCleanupFix(
        'I went to the market with him',
        'I went to the market with Tunde',
      ),
    ).toBe('I went to the market with him');
  });

  it('keeps what was heard when a fix changes a number or a date', () => {
    expect(
      guardCleanupFix(
        'she had about twenty goats',
        'she had about forty goats',
      ),
    ).toBe('she had about twenty goats');
    expect(
      guardCleanupFix('we moved there in 1998', 'we moved there in 1989'),
    ).toBe('we moved there in 1998');
  });

  it('keeps what was heard when a fix adds or drops a negation', () => {
    expect(
      guardCleanupFix(
        'I never went back to the farm',
        'I went back to the farm',
      ),
    ).toBe('I never went back to the farm');
    expect(guardCleanupFix('I liked school', "I didn't like school")).toBe(
      'I liked school',
    );
  });

  it('keeps what was heard when a fix adds new content', () => {
    expect(
      guardCleanupFix(
        'we moved to Kano',
        'we moved to Kano because my father got a job there',
      ),
    ).toBe('we moved to Kano');
  });

  it('keeps Latin-script words in another language instead of translating or erasing them', () => {
    expect(guardCleanupFix('Ja, das war verrückt', 'Yes, that was crazy')).toBe(
      'Ja, das war verrückt',
    );
    expect(
      guardCleanupFix(
        'my mother would say e kaabo',
        'my mother would say welcome',
      ),
    ).toBe('my mother would say e kaabo');
  });

  it('stores a rewrite of wrong-script text, or an explicit [unclear], as [unclear]', () => {
    expect(guardCleanupFix('لا أعرف ما أقول', "I don't know what to say")).toBe(
      '[unclear]',
    );
    expect(guardCleanupFix('nicht', '[unclear]')).toBe('[unclear]');
  });
});

describe('buildCleanupPrompt', () => {
  it('numbers each line and labels both speakers', () => {
    const prompt = buildCleanupPrompt([
      {id: 'a', index: 0, role: 'user', text: 'hello', memory: 'm'},
      {id: 'b', index: 1, role: 'ai', text: 'hi there', memory: 'm'},
    ]);
    expect(prompt).toContain('[0] Host: hello');
    expect(prompt).toContain('[1] Memento: hi there');
    expect(prompt).toContain('[unclear]');
    expect(prompt).toContain('Do not translate');
    expect(prompt).toContain(
      "Memento's reply is not proof of what the Host said",
    );
    expect(prompt).toContain('Never change names, places, dates, numbers');
  });
});

describe('cleanVoiceCallTranscript', () => {
  beforeAll(connectTestDatabase);
  afterEach(async () => {
    generate.mockReset();
    vi.mocked(addToInsightsBuffer).mockClear();
    await clearTestDatabase();
  });
  afterAll(closeTestDatabase);

  it('rewrites only Host lines, keeps originals, and queues cleaned insights', async () => {
    await seedCall();
    generate.mockResolvedValue(
      JSON.stringify({
        fixes: [
          {
            index: 0,
            text: "I spent every summer at my grandmother's farm in Kaduna",
          },
          {index: 1, text: 'should be ignored'},
          {index: 2, text: '[unclear]'},
        ],
      }),
    );

    expect(await cleanVoiceCallTranscript(userId, sessionId)).toBe('done');

    const turns = await loadCallTurns(userId, sessionId);
    expect(turns.map(t => t.text)).toEqual([
      "I spent every summer at my grandmother's farm in Kaduna",
      lines[1][1],
      '[unclear]',
      lines[3][1],
      lines[4][1],
      lines[5][1],
    ]);
    const cleaned = await Message.findOne({voice_turn_index: 2}).lean();
    expect(cleaned).toMatchObject({raw_text: 'لا أعرف', voice_cleaned: true});
    const untouched = await Message.findOne({voice_turn_index: 4}).lean();
    expect(untouched?.raw_text).toBeUndefined();

    const call = await VoiceCall.findOne({session_id: sessionId}).lean();
    expect(call?.cleanup_status).toBe('done');
    expect(call?.cleaned_at).toBeInstanceOf(Date);
    expect(call?.queue_insights).toBe(false);

    expect(vi.mocked(addToInsightsBuffer).mock.calls).toEqual([
      [
        userId,
        memoryId,
        "I spent every summer at my grandmother's farm in Kaduna",
        lines[1][1],
      ],
      [userId, memoryId, lines[4][1], lines[5][1]],
    ]);
  });

  it('runs once: a second call does not ask the model again', async () => {
    await seedCall();
    generate.mockResolvedValue('{"fixes":[]}');

    await cleanVoiceCallTranscript(userId, sessionId);
    expect(await cleanVoiceCallTranscript(userId, sessionId)).toBe('done');
    expect(generate).toHaveBeenCalledTimes(1);
    expect(addToInsightsBuffer).toHaveBeenCalledTimes(2);
  });

  it('changes nothing and marks the call failed on an invalid answer', async () => {
    await seedCall();
    generate.mockResolvedValue('Sorry, I cannot help with that.');

    expect(await cleanVoiceCallTranscript(userId, sessionId)).toBe('failed');

    const turns = await loadCallTurns(userId, sessionId);
    expect(turns.map(t => t.text)).toEqual(lines.map(([, text]) => text));
    expect(addToInsightsBuffer).not.toHaveBeenCalled();
    const call = await VoiceCall.findOne({session_id: sessionId}).lean();
    expect(call).toMatchObject({
      cleanup_status: 'failed',
      queue_insights: true,
    });
  });

  it('marks the call failed when the model errors, and retries later', async () => {
    await seedCall();
    generate.mockRejectedValueOnce(new Error('quota'));
    expect(await cleanVoiceCallTranscript(userId, sessionId)).toBe('failed');

    generate.mockResolvedValueOnce('{"fixes":[]}');
    expect(await cleanVoiceCallTranscript(userId, sessionId)).toBe('done');
    expect(addToInsightsBuffer).toHaveBeenCalledTimes(2);
  });

  it('does not queue insights for calls that did not end normally', async () => {
    await seedCall(false);
    generate.mockResolvedValue('{"fixes":[]}');

    expect(await cleanVoiceCallTranscript(userId, sessionId)).toBe('done');
    expect(addToInsightsBuffer).not.toHaveBeenCalled();
  });
});
