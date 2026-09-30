import {
  EndSensitivity,
  FunctionDeclaration,
  LiveConnectConfig,
  Modality,
  StartSensitivity,
  Tool,
  Type,
} from '@google/genai';

export const SEARCH_MEMORIES_TOOL_NAME = 'search_memories';

export const VOICE_TOOLS: Tool[] = [
  {
    functionDeclarations: [
      {
        name: SEARCH_MEMORIES_TOOL_NAME,
        description:
          "Search the host's saved memories, stories and earlier conversations. Use it when the host mentions a specific past event, person, place or conversation that is not in your context.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            query: {
              type: Type.STRING,
              description:
                'A short search phrase, for example "grandma\'s farm" or "trip to Lagos".',
            },
          },
          required: ['query'],
        },
      },
    ],
  },
];

export const END_CALL_TOOL_NAME = 'end_call';
export const SET_MICROPHONE_TOOL_NAME = 'set_microphone';
export const OPEN_SCREEN_TOOL_NAME = 'open_screen';
export const CALL_ACTION_TOOL_NAMES = [
  END_CALL_TOOL_NAME,
  SET_MICROPHONE_TOOL_NAME,
  OPEN_SCREEN_TOOL_NAME,
];

// Keep in sync with VOICE_DESTINATIONS in
// mobile/src/features/chat/voice-call-actions.ts. The app answers unknown
// destinations with "That screen isn't available".
export const VOICE_SCREEN_DESTINATIONS = [
  'home',
  'chat',
  'stories',
  'new_story',
  'quick_note',
  'time_capsules',
  'explore_prompts',
  'insights',
  'account',
  'settings',
  'profile',
  'plan_and_billing',
  'upgrade',
  'privacy',
  'beneficiaries',
  'feedback',
  'activity',
  'two_factor',
];

export const CALL_ACTION_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: END_CALL_TOOL_NAME,
    description:
      'End the voice call. Say one short goodbye first, then call this. Use it only when the host clearly wants to stop talking.',
  },
  {
    name: SET_MICROPHONE_TOOL_NAME,
    description:
      "Mute the host's microphone when they ask you to stop listening or give them a moment. You cannot unmute: the host taps to unmute.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        muted: {type: Type.BOOLEAN, description: 'Always true.'},
      },
      required: ['muted'],
    },
  },
  {
    name: OPEN_SCREEN_TOOL_NAME,
    description:
      'Open a screen in the Memento app when the host asks to see it. First ask whether they want to keep talking while they look or wrap up, unless they already said.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        destination: {
          type: Type.STRING,
          enum: VOICE_SCREEN_DESTINATIONS,
          description: 'The screen to open.',
        },
        keep_talking: {
          type: Type.BOOLEAN,
          description:
            'True keeps the call going in a floating bar. False means you say goodbye and the call ends before the screen opens.',
        },
      },
      required: ['destination', 'keep_talking'],
    },
  },
];

export type VoiceToolOptions = {memoryTool?: boolean; callActions?: boolean};

/** All enabled declarations go in one Tool, as the Live API expects. */
export function buildVoiceTools(options: VoiceToolOptions): Tool[] | undefined {
  const declarations: FunctionDeclaration[] = [
    ...(options.memoryTool ? (VOICE_TOOLS[0].functionDeclarations ?? []) : []),
    ...(options.callActions ? CALL_ACTION_DECLARATIONS : []),
  ];
  return declarations.length
    ? [{functionDeclarations: declarations}]
    : undefined;
}

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
  options: VoiceToolOptions = {},
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

  const tools = buildVoiceTools(options);
  if (tools) {
    config.tools = tools;
  }

  if (systemInstruction?.trim()) {
    config.systemInstruction = systemInstruction.trim();
  }

  return config;
}
