import {
  EndSensitivity,
  LiveConnectConfig,
  Modality,
  StartSensitivity,
} from '@google/genai';

// Starting values. Tune from the mobile voice session metrics
// (false interruptions per 10 min, end-of-speech to first audio p50/p95).
export const VOICE_TURN_DETECTION = {
  startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_LOW,
  endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_UNSPECIFIED,
  // Speech must last this long before Gemini treats it as the user talking.
  // 20 ms made echo and room noise trigger interruptions.
  prefixPaddingMs: 200,
  silenceDurationMs: 800,
} as const;

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
  resumeHandle?: string,
): LiveConnectConfig {
  const config: LiveConnectConfig = {
    // A handle resumes the same Gemini session after goAway or a network drop.
    sessionResumption: resumeHandle ? {handle: resumeHandle} : {},
    // Without compression Gemini caps audio sessions at 15 minutes.
    contextWindowCompression: {slidingWindow: {}},
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
        ...VOICE_TURN_DETECTION,
      },
    },
  };

  if (systemInstruction?.trim()) {
    config.systemInstruction = systemInstruction.trim();
  }

  return config;
}
