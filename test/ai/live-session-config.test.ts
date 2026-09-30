import {describe, expect, it} from 'vitest';
import {Modality} from '@google/genai';
import {
  buildLiveConnectConfig,
  buildLiveSessionDescriptor,
} from '../../src/module/api/ai/live-session-config';

describe('Gemini Live session descriptor', () => {
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
      responseModalities: [Modality.AUDIO],
      systemInstruction: 'Always answer in English.',
      speechConfig: {
        languageCode: 'en-US',
        voiceConfig: {
          prebuiltVoiceConfig: {voiceName: 'Fenrir'},
        },
      },
      inputAudioTranscription: {languageCodes: ['en-US', 'en']},
      outputAudioTranscription: {languageCodes: ['en-US', 'en']},
      realtimeInputConfig: {
        automaticActivityDetection: {
          disabled: false,
          prefixPaddingMs: 20,
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
});
