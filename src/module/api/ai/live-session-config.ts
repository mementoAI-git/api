import {LiveConnectConfig, Modality} from '@google/genai';

export type GeminiVoiceDescriptor = {
  id: string;
  name: string;
  provider: 'gemini';
};

export function buildLiveSessionDescriptor(
  model: string,
  voice: GeminiVoiceDescriptor,
) {
  return {model, voice};
}

export function buildLiveConnectConfig(
  voiceName: string,
  systemInstruction?: string,
): LiveConnectConfig {
  const config: LiveConnectConfig = {
    sessionResumption: {},
    responseModalities: [Modality.AUDIO],
    speechConfig: {
      languageCode: 'en-US',
      voiceConfig: {
        prebuiltVoiceConfig: {voiceName},
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
  };

  if (systemInstruction?.trim()) {
    config.systemInstruction = systemInstruction.trim();
  }

  return config;
}
