import {createHash} from 'crypto';
import {
  EndSensitivity,
  FunctionDeclaration,
  LiveConnectConfig,
  Modality,
  StartSensitivity,
  Tool,
  Type,
} from '@google/genai';
import {SERVER_TOOL_DECLARATIONS} from './voice/server-tool-declarations';
import {
  SCREEN_CONTROL_CAPABILITY,
  SCREEN_CONTROL_DECLARATIONS,
} from './voice/screen-control-declarations';

export const SEARCH_MEMORIES_TOOL_NAME = 'search_memories';

// Capability names a client can send on GET /ai/ephemeral-token. App builds
// send the tool name `search_memories`; the documented name was
// `memory_search`. Both enable the memory tool so every shipped build gets it.
const MEMORY_SEARCH_CAPABILITIES = ['memory_search', SEARCH_MEMORIES_TOOL_NAME];
const CALL_ACTIONS_CAPABILITY = 'call_actions';

/**
 * Builds that forward server-run tools to POST /ai/voice/tools/:name and
 * apply their effects. Any server tool works through it, so new ones need no
 * app release.
 */
export const SERVER_TOOLS_CAPABILITY = 'server_tools';

export function parseVoiceClientCapabilities(raw: unknown): {
  memoryTool: boolean;
  callActions: boolean;
  serverTools: boolean;
  screenControl: boolean;
} {
  const capabilities =
    typeof raw === 'string' ? raw.split(',').map(value => value.trim()) : [];
  return {
    memoryTool: MEMORY_SEARCH_CAPABILITIES.some(name =>
      capabilities.includes(name),
    ),
    callActions: capabilities.includes(CALL_ACTIONS_CAPABILITY),
    serverTools: capabilities.includes(SERVER_TOOLS_CAPABILITY),
    screenControl: capabilities.includes(SCREEN_CONTROL_CAPABILITY),
  };
}

export const VOICE_TOOLS: Tool[] = [
  {
    functionDeclarations: [
      {
        name: SEARCH_MEMORIES_TOOL_NAME,
        description:
          'Search everything the host has shared in Memento: their stories, memories and past conversations, including earlier voice calls. Use it whenever the host asks what you remember or know about them, or about someone or something in their life, and whenever they mention a past event, person, place or conversation that is not in your context.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            query: {
              type: Type.STRING,
              description:
                'A short search phrase, for example "grandma\'s farm" or "trip to Lagos".',
            },
            also: {
              type: Type.ARRAY,
              items: {type: Type.STRING},
              description:
                'Up to 3 other ways to say it: names, places or words they might have used ("Emeka" for "my brother").',
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
      'End the voice call. Call it as soon as the host clearly wants to stop talking, then say one short goodbye. The app hangs up after your goodbye finishes playing.',
  },
  {
    name: SET_MICROPHONE_TOOL_NAME,
    description:
      "Mute the host's microphone. Call it, before you reply, when the host explicitly asks you to mute, stop listening, or hold on while they deal with something. You cannot unmute: the host taps to unmute.",
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
      'Open a screen in the Memento app when the host asks to see it. The call keeps going while they look, so you can keep helping on that screen (scroll, tap, read it). Never ask whether they want to keep talking.',
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
            'True (the normal case): the call keeps going in a floating bar. False only when the host has said they want to stop talking: you say goodbye and the call ends before the screen opens.',
        },
      },
      required: ['destination', 'keep_talking'],
    },
  },
];

export type VoiceToolOptions = {
  memoryTool?: boolean;
  callActions?: boolean;
  serverTools?: boolean;
  screenControl?: boolean;
};

/** All enabled declarations go in one Tool, as the Live API expects. */
export function buildVoiceTools(options: VoiceToolOptions): Tool[] | undefined {
  const declarations: FunctionDeclaration[] = [
    ...(options.memoryTool ? (VOICE_TOOLS[0].functionDeclarations ?? []) : []),
    ...(options.callActions ? CALL_ACTION_DECLARATIONS : []),
    ...(options.serverTools ? SERVER_TOOL_DECLARATIONS : []),
    ...(options.screenControl ? SCREEN_CONTROL_DECLARATIONS : []),
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
  // Google's guide and API schema describe this differently (required speech
  // before a start is committed, or audio kept before it). 20 ms coincided
  // with more false interruptions; do not rely on it as an echo filter. The
  // app filters echo on the loudspeaker itself.
  prefixPaddingMs: 200,
  silenceDurationMs: 800,
} as const;

export type VoiceTurnDetectionArm = {
  /** Reported to the app so its metrics can be split by arm. */
  variant: string;
  settings: {
    startOfSpeechSensitivity: StartSensitivity;
    endOfSpeechSensitivity: EndSensitivity;
    prefixPaddingMs: number;
    silenceDurationMs: number;
  };
};

// A/B on the silence window that ends the user's turn. The fast arm answers
// sooner but may cut people off mid-thought. In the app's Sentry voice.call
// transactions, split by `voice.turn_variant` and compare
// `voice_reply_audible_p50` (what the user hears) against
// `voice_reply_early_interruptions` per reply. The latter is a proxy: it also
// counts quick corrections, so compare arms on the same audio route
// (`voice.route`, `voice.speaker_full_duplex`), never across them.
// Rename a variant whenever its settings change.
export const VOICE_TURN_CONTROL: VoiceTurnDetectionArm = {
  variant: 'silence-800',
  settings: VOICE_TURN_DETECTION,
};

export const VOICE_TURN_FAST: VoiceTurnDetectionArm = {
  variant: 'silence-450',
  settings: {...VOICE_TURN_DETECTION, silenceDurationMs: 450},
};

/** Stable 0-99 bucket per user, so a user hears the same arm on every call. */
function voiceTurnBucket(userId: string): number {
  const digest = createHash('sha256')
    .update(`voice-turn-ab:${userId}`)
    .digest();
  return digest.readUInt32BE(0) % 100;
}

/**
 * Puts `fastPercent` of users in the fast arm. Raising the percentage only
 * adds users to the fast arm; nobody already in it moves back.
 */
export function chooseVoiceTurnDetection(
  userId: string,
  fastPercent: number,
): VoiceTurnDetectionArm {
  return voiceTurnBucket(userId) < fastPercent
    ? VOICE_TURN_FAST
    : VOICE_TURN_CONTROL;
}

export function describeVoiceTurnDetection(arm: VoiceTurnDetectionArm) {
  return {
    variant: arm.variant,
    silenceDurationMs: arm.settings.silenceDurationMs,
    prefixPaddingMs: arm.settings.prefixPaddingMs,
  };
}

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
  turnDetection: VoiceTurnDetectionArm = VOICE_TURN_CONTROL,
): LiveConnectConfig {
  const config: LiveConnectConfig = {
    // A handle resumes the same Gemini session after goAway or a network drop.
    sessionResumption: resumeHandle ? {handle: resumeHandle} : {},
    // Without compression Gemini caps audio sessions at 15 minutes.
    contextWindowCompression: {slidingWindow: {}},
    responseModalities: [Modality.AUDIO],
    // No languageCode: native-audio Live models choose the language
    // themselves and do not support setting it. The voice prompt asks for
    // English.
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: {voiceName},
      },
    },
    // Presence enables transcription. The Gemini Developer API rejects
    // languageCodes during ephemeral-token serialization, so use automatic
    // language detection instead of SDK fields supported only by other APIs.
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    // No thinkingConfig: Google's gemini-3.8-live guide says to omit
    // thinking_config (the model reasons internally). An earlier
    // thinkingBudget: 0 was accepted but is outside the documented contract.
    realtimeInputConfig: {
      automaticActivityDetection: {
        disabled: false,
        ...turnDetection.settings,
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
