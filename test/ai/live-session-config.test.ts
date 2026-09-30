import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  EndSensitivity,
  GoogleGenAI,
  Modality,
  StartSensitivity,
} from '@google/genai';
import {
  buildLiveConnectConfig,
  buildLiveSessionDescriptor,
} from '../../src/module/api/ai/live-session-config';

describe('Gemini Live session descriptor', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the exact model and resolved voice used by token constraints', () => {
    expect(
      buildLiveSessionDescriptor('gemini-3.8-live', {
        id: 'denver',
        name: 'Fenrir',
        provider: 'gemini',
      }),
    ).toEqual({
      model: 'gemini-3.8-live',
      voice: {id: 'denver', name: 'Fenrir', provider: 'gemini'},
    });
  });

  it('locks the complete transcription-enabled Live connection config', () => {
    expect(
      buildLiveConnectConfig('Fenrir', ' Always answer in English. '),
    ).toEqual({
      sessionResumption: {},
      contextWindowCompression: {slidingWindow: {}},
      responseModalities: [Modality.AUDIO],
      systemInstruction: 'Always answer in English.',
      speechConfig: {
        languageCode: 'en-US',
        voiceConfig: {
          prebuiltVoiceConfig: {voiceName: 'Fenrir'},
        },
      },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      realtimeInputConfig: {
        automaticActivityDetection: {
          disabled: false,
          startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_LOW,
          endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_UNSPECIFIED,
          prefixPaddingMs: 200,
          silenceDurationMs: 800,
        },
      },
    });
  });

  it('omits an empty system instruction from the locked config', () => {
    expect(buildLiveConnectConfig('Aoede', '   ')).not.toHaveProperty(
      'systemInstruction',
    );
  });

  it('serializes transcription markers through the Gemini token client', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({name: 'authTokens/test'}), {
        status: 200,
        headers: {'content-type': 'application/json'},
      }),
    );
    const client = new GoogleGenAI({
      apiKey: 'test-api-key',
      httpOptions: {
        apiVersion: 'v1alpha',
        baseUrl: 'https://gemini.test',
      },
    });

    await client.authTokens.create({
      config: {
        uses: 1,
        liveConnectConstraints: {
          model: 'gemini-test-live',
          config: buildLiveConnectConfig('Fenrir', 'Always answer in English.'),
        },
      },
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const requestInit = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(String(requestInit?.body));

    expect(body.bidiGenerateContentSetup).toMatchObject({
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    });
    expect(body.bidiGenerateContentSetup).toMatchObject({
      contextWindowCompression: {slidingWindow: {}},
    });
  });
});
