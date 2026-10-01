import {afterEach, describe, expect, it, vi} from 'vitest';

const router = vi.hoisted(() => ({size: 1, generateText: vi.fn()}));

vi.mock('../../src/services/gemini', () => ({
  default: {models: {generateContent: vi.fn()}},
  GEMINI_MODEL: 'test-model',
}));
vi.mock('../../src/services/ai', () => ({default: router}));
vi.mock('../../src/services/ai/metrics', () => ({
  recordAiMetric: vi.fn().mockResolvedValue(undefined),
}));

import gemini from '../../src/services/gemini';
import {generateVoiceJson} from '../../src/module/api/ai/voice/text-generator';

const generateContent = vi.mocked(gemini.models.generateContent);
const busy = Object.assign(new Error('high demand'), {status: 503});
const dailyQuota = Object.assign(new Error('RESOURCE_EXHAUSTED'), {
  status: 429,
});
const isJson = (raw: string) => raw.startsWith('{');

describe('generateVoiceJson', () => {
  afterEach(() => {
    generateContent.mockReset();
    router.generateText.mockReset();
    router.size = 1;
  });

  it('uses the provider router first and skips Gemini', async () => {
    router.generateText.mockResolvedValue('{"fixes":[]}');
    await expect(
      generateVoiceJson('voice_transcript_cleanup', 'prompt', 'u1'),
    ).resolves.toBe('{"fixes":[]}');
    expect(router.generateText).toHaveBeenCalledWith([
      expect.objectContaining({role: 'system'}),
      {role: 'user', content: 'prompt'},
    ]);
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('falls back to Gemini when every router provider fails', async () => {
    router.generateText.mockRejectedValue(new Error('all providers failed'));
    generateContent.mockResolvedValue({text: '{"fixes":[]}'} as any);
    await expect(
      generateVoiceJson('voice_transcript_cleanup', 'prompt', 'u1'),
    ).resolves.toBe('{"fixes":[]}');
    expect(generateContent).toHaveBeenCalledWith({
      model: 'test-model',
      contents: 'prompt',
      config: {responseMimeType: 'application/json', temperature: 0.2},
    });
  });

  it('falls back to Gemini when the router answer is unusable', async () => {
    router.generateText.mockResolvedValue('Sure! Here is the summary.');
    generateContent.mockResolvedValue({text: '{"summary":"x"}'} as any);
    await expect(
      generateVoiceJson('voice_call_summary', 'p', 'u1', {accept: isJson}),
    ).resolves.toBe('{"summary":"x"}');
  });

  it('calls Gemini directly when no router provider is configured', async () => {
    router.size = 0;
    generateContent.mockResolvedValue({text: 'ok'} as any);
    await expect(
      generateVoiceJson('voice_call_summary', 'p', 'u1'),
    ).resolves.toBe('ok');
    expect(router.generateText).not.toHaveBeenCalled();
  });

  it('retries Gemini when it is briefly overloaded', async () => {
    router.size = 0;
    generateContent
      .mockRejectedValueOnce(busy)
      .mockResolvedValueOnce({text: 'ok'} as any);
    await expect(
      generateVoiceJson('voice_call_summary', 'p', 'u1', {retryDelaysMs: [0]}),
    ).resolves.toBe('ok');
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it('gives up after the last retry', async () => {
    router.size = 0;
    generateContent.mockRejectedValue(busy);
    await expect(
      generateVoiceJson('voice_call_summary', 'p', 'u1', {
        retryDelaysMs: [0, 0],
      }),
    ).rejects.toThrow('high demand');
    expect(generateContent).toHaveBeenCalledTimes(3);
  });

  it('does not retry a used-up quota', async () => {
    router.size = 0;
    generateContent.mockRejectedValue(dailyQuota);
    await expect(
      generateVoiceJson('voice_call_summary', 'p', 'u1', {retryDelaysMs: [0]}),
    ).rejects.toThrow('RESOURCE_EXHAUSTED');
    expect(generateContent).toHaveBeenCalledTimes(1);
  });
});
