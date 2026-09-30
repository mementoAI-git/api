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
    // Presence enables transcription. The Gemini Developer API rejects
    // languageCodes during ephemeral-token serialization, so use automatic
    // language detection instead of SDK fields supported only by other APIs.
    inputAudioTranscription: {},
    outputAudioTranscription: {},
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
