import {afterEach, describe, expect, it, vi} from 'vitest';

vi.mock('../../src/services/gemini', () => ({
  default: {models: {generateContent: vi.fn()}},
  GEMINI_MODEL: 'test-model',
}));
vi.mock('../../src/services/ai/metrics', () => ({
  recordAiMetric: vi.fn().mockResolvedValue(undefined),
}));

import gemini from '../../src/services/gemini';
import {generateVoiceJson} from '../../src/module/api/ai/voice/text-generator';

const generateContent = vi.mocked(gemini.models.generateContent);
const busy = Object.assign(new Error('high demand'), {status: 503});

describe('generateVoiceJson', () => {
  afterEach(() => generateContent.mockReset());

  it('asks Gemini for JSON and returns the text', async () => {
    generateContent.mockResolvedValue({text: '{"fixes":[]}'} as any);
    await expect(
      generateVoiceJson('voice_transcript_cleanup', 'prompt', 'u1', []),
    ).resolves.toBe('{"fixes":[]}');
    expect(generateContent).toHaveBeenCalledWith({
      model: 'test-model',
      contents: 'prompt',
      config: {responseMimeType: 'application/json', temperature: 0.2},
    });
  });

  it('retries when Gemini is busy', async () => {
    generateContent
      .mockRejectedValueOnce(busy)
      .mockResolvedValueOnce({text: 'ok'} as any);
    await expect(
      generateVoiceJson('voice_call_summary', 'p', 'u1', [0]),
    ).resolves.toBe('ok');
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it('gives up after the last retry', async () => {
    generateContent.mockRejectedValue(busy);
    await expect(
      generateVoiceJson('voice_call_summary', 'p', 'u1', [0, 0]),
    ).rejects.toThrow('high demand');
    expect(generateContent).toHaveBeenCalledTimes(3);
  });

  it('does not retry other errors', async () => {
    generateContent.mockRejectedValue(
      Object.assign(new Error('bad request'), {status: 400}),
    );
    await expect(
      generateVoiceJson('voice_call_summary', 'p', 'u1', [0]),
    ).rejects.toThrow('bad request');
    expect(generateContent).toHaveBeenCalledTimes(1);
  });
});
