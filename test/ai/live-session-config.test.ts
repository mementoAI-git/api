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
  CALL_ACTION_TOOL_NAMES,
  parseVoiceClientCapabilities,
  SEARCH_MEMORIES_TOOL_NAME,
  VOICE_SCREEN_DESTINATIONS,
  VOICE_TOOLS,
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

  // gemini-3.8-live is a native-audio model: Google documents that it picks
  // the language itself and does not support setting it, and that
  // thinking_config must be omitted. Unsupported fields risk setup failures.
  it('does not lock fields the native-audio Live model does not support', () => {
    const config = buildLiveConnectConfig('Fenrir', 'hi');
    expect(config.speechConfig).not.toHaveProperty('languageCode');
    expect(config).not.toHaveProperty('thinkingConfig');
  });

  it('omits an empty system instruction from the locked config', () => {
    expect(buildLiveConnectConfig('Aoede', '   ')).not.toHaveProperty(
      'systemInstruction',
    );
  });

  it('locks a resume handle into the session when one is given', () => {
    expect(
      buildLiveConnectConfig('Fenrir', 'hi', 'handle-123').sessionResumption,
    ).toEqual({handle: 'handle-123'});
    expect(buildLiveConnectConfig('Fenrir', 'hi').sessionResumption).toEqual(
      {},
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

  it('declares the memory search tool only when requested', async () => {
    expect(buildLiveConnectConfig('Fenrir', 'hi')).not.toHaveProperty('tools');
    const config = buildLiveConnectConfig('Fenrir', 'hi', undefined, {
      memoryTool: true,
    });
    expect(config.tools).toEqual(VOICE_TOOLS);
    expect(VOICE_TOOLS[0].functionDeclarations?.[0]).toMatchObject({
      name: SEARCH_MEMORIES_TOOL_NAME,
      parameters: {required: ['query']},
    });

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({name: 'authTokens/test'}), {
        status: 200,
        headers: {'content-type': 'application/json'},
      }),
    );
    const client = new GoogleGenAI({
      apiKey: 'test-api-key',
      httpOptions: {apiVersion: 'v1alpha', baseUrl: 'https://gemini.test'},
    });
    await client.authTokens.create({
      config: {
        uses: 1,
        liveConnectConstraints: {model: 'gemini-test-live', config},
      },
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(JSON.stringify(body.bidiGenerateContentSetup)).toContain(
      SEARCH_MEMORIES_TOOL_NAME,
    );
  });

  it('declares call actions only when requested, in the same tool as memory search', async () => {
    const memoryOnly = buildLiveConnectConfig('Fenrir', 'hi', undefined, {
      memoryTool: true,
    });
    expect(memoryOnly.tools).toEqual(VOICE_TOOLS);

    const both = buildLiveConnectConfig('Fenrir', 'hi', undefined, {
      memoryTool: true,
      callActions: true,
    });
    expect(both.tools).toHaveLength(1);
    const declarations = both.tools?.[0] as {
      functionDeclarations: {name: string; parameters?: any}[];
    };
    expect(declarations.functionDeclarations.map(d => d.name)).toEqual([
      SEARCH_MEMORIES_TOOL_NAME,
      ...CALL_ACTION_TOOL_NAMES,
    ]);
    const openScreen = declarations.functionDeclarations.find(
      d => d.name === 'open_screen',
    );
    expect(openScreen?.parameters.properties.destination.enum).toEqual(
      VOICE_SCREEN_DESTINATIONS,
    );
    expect(openScreen?.parameters.required).toEqual([
      'destination',
      'keep_talking',
    ]);

    const actionsOnly = buildLiveConnectConfig('Fenrir', 'hi', undefined, {
      callActions: true,
    });
    expect(
      (
        actionsOnly.tools?.[0] as {functionDeclarations: {name: string}[]}
      ).functionDeclarations.map(d => d.name),
    ).toEqual(CALL_ACTION_TOOL_NAMES);

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({name: 'authTokens/test'}), {
        status: 200,
        headers: {'content-type': 'application/json'},
      }),
    );
    const client = new GoogleGenAI({
      apiKey: 'test-api-key',
      httpOptions: {apiVersion: 'v1alpha', baseUrl: 'https://gemini.test'},
    });
    await client.authTokens.create({
      config: {
        uses: 1,
        liveConnectConstraints: {model: 'gemini-test-live', config: both},
      },
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const serialized = JSON.stringify(body.bidiGenerateContentSetup);
    for (const name of CALL_ACTION_TOOL_NAMES)
      expect(serialized).toContain(name);
    expect(serialized).toContain('time_capsules');
  });
});

describe('voice client capabilities', () => {
  // The exact query string current app builds send (mobile
  // CLIENT_CAPABILITIES = [SEARCH_MEMORIES_TOOL, CALL_ACTIONS_CAPABILITY]).
  // The API used to check only `memory_search`, so the memory tool was never
  // locked into any app call.
  it('enables memory search for the name the app actually sends', () => {
    expect(
      parseVoiceClientCapabilities('search_memories,call_actions'),
    ).toEqual({
      memoryTool: true,
      callActions: true,
    });
  });

  it('still accepts the documented memory_search name', () => {
    expect(parseVoiceClientCapabilities('memory_search')).toEqual({
      memoryTool: true,
      callActions: false,
    });
  });

  it('ignores whitespace, unknown names and missing values', () => {
    expect(parseVoiceClientCapabilities(' call_actions , unknown ')).toEqual({
      memoryTool: false,
      callActions: true,
    });
    expect(parseVoiceClientCapabilities(undefined)).toEqual({
      memoryTool: false,
      callActions: false,
    });
    expect(parseVoiceClientCapabilities(['search_memories'])).toEqual({
      memoryTool: false,
      callActions: false,
    });
  });
});
