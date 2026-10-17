import {afterEach, describe, expect, it, vi} from 'vitest';
import axios from 'axios';
import {synthesizeSpokenReply} from '../../src/services/spoken-replies';
vi.mock('../../src/utils/config', () => ({
  GEMINI_API_KEY_EFFECTIVE: 'test-only-key',
  GEMINI_TTS_MODEL_VERSION: 'gemini-3.8-flash-tts',
}));
afterEach(() => vi.restoreAllMocks());
describe('Gemini exact-text speech', () => {
  it('sends the selected voice, exact transcript, separate style metadata and no stored interaction', async () => {
    const post = vi.spyOn(axios, 'post').mockResolvedValue({
      data: {
        steps: [
          {
            type: 'model_output',
            content: [{type: 'audio', data: 'YXVkaW8='}],
          },
        ],
      },
    });
    const signal = new AbortController().signal;
    expect(
      await synthesizeSpokenReply('Hello, Memento.', 'Kore', signal),
    ).toEqual({
      audioBase64: 'YXVkaW8=',
      mimeType: 'audio/wav',
      voiceName: 'Kore',
    });
    expect(post).toHaveBeenCalledWith(
      expect.stringContaining('/v1beta/interactions'),
      expect.objectContaining({
        model: 'gemini-3.8-flash-tts',
        store: false,
        generation_config: {speech_config: [{voice: 'Kore'}]},
        input: [
          {
            type: 'user_input',
            content: [
              expect.objectContaining({
                type: 'text',
                text: 'Hello, Memento.',
                annotations: [
                  expect.objectContaining({type: 'speech_metadata'}),
                ],
              }),
            ],
          },
        ],
      }),
      expect.objectContaining({signal, timeout: 45000}),
    );
  });
  it('rejects empty provider output', async () => {
    vi.spyOn(axios, 'post').mockResolvedValue({data: {steps: []}});
    await expect(
      synthesizeSpokenReply('Hello', 'Fenrir'),
    ).rejects.toMatchObject({statusCode: 503});
  });
  it('maps throttling without leaking provider errors, text or credentials', async () => {
    vi.spyOn(axios, 'post').mockRejectedValue({
      isAxiosError: true,
      response: {status: 429},
      message: 'provider-secret',
    });
    await expect(
      synthesizeSpokenReply('private text', 'Fenrir'),
    ).rejects.toMatchObject({statusCode: 429});
  });
  it('does not retry timeouts or provider failures', async () => {
    const post = vi
      .spyOn(axios, 'post')
      .mockRejectedValue(new Error('private upstream detail'));
    await expect(
      synthesizeSpokenReply('Hello', 'Fenrir'),
    ).rejects.toMatchObject({
      statusCode: 503,
      message: 'Could not generate spoken audio. Please try again.',
    });
    expect(post).toHaveBeenCalledOnce();
  });
});
