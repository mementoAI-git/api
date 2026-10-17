import axios from 'axios';
import {
  GEMINI_API_KEY_EFFECTIVE,
  GEMINI_TTS_MODEL_VERSION,
} from '../utils/config';
import {
  ServiceUnavailableException,
  TooManyRequestsException,
} from '../utils/service-error';

interface SpeechResponse {
  steps?: Array<{
    type?: string;
    content?: Array<{type?: string; data?: string}>;
  }>;
}

/** Exact-text narration; the API key and delivery instructions stay server-side. */
export async function synthesizeSpokenReply(
  text: string,
  voiceName: string,
  signal?: AbortSignal,
) {
  if (!GEMINI_API_KEY_EFFECTIVE) {
    throw new ServiceUnavailableException('Spoken replies are not configured.');
  }
  try {
    const response = await axios.post<SpeechResponse>(
      'https://generativelanguage.googleapis.com/v1beta/interactions',
      {
        model: GEMINI_TTS_MODEL_VERSION,
        store: false,
        input: [
          {
            type: 'user_input',
            content: [
              {
                type: 'text',
                text,
                annotations: [
                  {
                    type: 'speech_metadata',
                    style:
                      'Warm, natural and conversational. Speak at a relaxed, clear pace with gentle expression. Avoid an announcer or robotic delivery.',
                  },
                ],
              },
            ],
          },
        ],
        response_format: {type: 'audio'},
        generation_config: {speech_config: [{voice: voiceName}]},
      },
      {
        headers: {
          'x-goog-api-key': GEMINI_API_KEY_EFFECTIVE,
          'Content-Type': 'application/json',
        },
        timeout: 45_000,
        maxContentLength: 16 * 1024 * 1024,
        signal,
      },
    );
    const audio = response.data.steps
      ?.filter(step => step.type === 'model_output')
      .flatMap(step => step.content ?? [])
      .filter(part => part.type === 'audio' && part.data)
      .at(-1);
    if (!audio?.data)
      throw new ServiceUnavailableException('No speech audio was returned.');
    return {audioBase64: audio.data, mimeType: 'audio/wav' as const, voiceName};
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 429) {
      throw new TooManyRequestsException(
        'Spoken replies are busy. Please try again shortly.',
      );
    }
    // Never surface an Axios error containing the provider credential or transcript.
    throw new ServiceUnavailableException(
      'Could not generate spoken audio. Please try again.',
    );
  }
}
