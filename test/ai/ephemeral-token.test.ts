import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';

vi.mock('../../src/services/supermemory', () => ({
  getContextForUser: vi.fn().mockResolvedValue({formatedText: ''}),
}));

import {GoogleGenAI} from '@google/genai';
import {geminiAuthClient} from '../../src/services/gemini';
import Memory from '../../src/module/database/model/memory';
import Message from '../../src/module/database/model/message';
import {createEphemeralToken} from '../../src/module/api/ai/service';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';
import {createUserFixture} from '../helpers/factories';

describe('createEphemeralToken', () => {
  beforeAll(connectTestDatabase);
  afterEach(async () => {
    vi.restoreAllMocks();
    await clearTestDatabase();
  });
  afterAll(closeTestDatabase);

  it('locks a voice-specific instruction with conversation turns into the token', async () => {
    const create = vi
      .spyOn(geminiAuthClient.authTokens, 'create')
      .mockResolvedValue({name: 'authTokens/test'} as any);
    const user = await createUserFixture();
    const memory = await Memory.create({
      user: user.id,
      type: 'conversation',
      status: 'save',
    });
    await Message.create({
      user: user.id,
      memory: memory.id,
      role: 'user',
      text: 'Tell me about sleep',
    });

    const {data} = await createEphemeralToken(user.id, memory.id);

    const locked = create.mock.calls[0][0].config.liveConnectConstraints.config;
    const instruction = String(locked.systemInstruction);
    expect(instruction).toContain('VOICE MODE');
    expect(instruction).toContain('Host: Tell me about sleep');
    expect(data.token).toBe('authTokens/test');
    expect(data.greetingInstruction).toMatch(/Greet/);
    expect(data.memoryId).toBe(memory.id);
    expect(data.promptVersion).toMatch(/^voice-/);
    expect(data).not.toHaveProperty('systemInstruction');
  });

  it('sends Gemini no field mask, which would be invalid with tools locked in', async () => {
    // Runs the real SDK request shaping; only the network call is stubbed.
    // `lockAdditionalFields: []` made the SDK send a field mask containing
    // `tools.0`, which Gemini rejects ("field_mask is invalid for
    // BidiGenerateContentSetup"), so every voice call failed with a 500.
    // A client with a dummy key keeps this independent of GEMINI_API_KEY and
    // of Google default credentials, which CI has neither of.
    const sdk = new GoogleGenAI({
      apiKey: 'test-key',
      httpOptions: {apiVersion: 'v1alpha'},
    });
    vi.spyOn(geminiAuthClient.authTokens, 'create').mockImplementation(params =>
      sdk.authTokens.create(params),
    );
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({name: 'authTokens/real-sdk'}), {
        status: 200,
        headers: {'content-type': 'application/json'},
      }),
    );
    const user = await createUserFixture();

    const {data} = await createEphemeralToken(user.id, undefined, undefined, {
      memoryTool: true,
      callActions: true,
    });

    const call = fetchSpy.mock.calls.find(([, init]) =>
      String(init?.body ?? '').includes('bidiGenerateContentSetup'),
    );
    const body = JSON.parse(String(call?.[1]?.body));
    expect(body.bidiGenerateContentSetup.tools).toBeDefined();
    expect(body).not.toHaveProperty('fieldMask');
    expect(data.token).toBe('authTokens/real-sdk');
  });

  it('locks the resume handle into the token when reconnecting', async () => {
    const create = vi
      .spyOn(geminiAuthClient.authTokens, 'create')
      .mockResolvedValue({name: 'authTokens/resume'} as any);
    const user = await createUserFixture();

    await createEphemeralToken(user.id, undefined, 'handle-abc');

    const locked = create.mock.calls[0][0].config.liveConnectConstraints.config;
    expect(locked.sessionResumption).toEqual({handle: 'handle-abc'});
  });

  it('locks the memory tool in only for clients that support it', async () => {
    const create = vi
      .spyOn(geminiAuthClient.authTokens, 'create')
      .mockResolvedValue({name: 'authTokens/tools'} as any);
    const user = await createUserFixture();

    const legacy = await createEphemeralToken(user.id);
    const capable = await createEphemeralToken(user.id, undefined, undefined, {
      memoryTool: true,
      deviceModel: 'Pixel 8',
    });

    expect(
      create.mock.calls[0][0].config.liveConnectConstraints.config,
    ).not.toHaveProperty('tools');
    expect(legacy.data.tools).toEqual([]);
    const locked = create.mock.calls[1][0].config.liveConnectConstraints.config;
    expect(JSON.stringify(locked.tools)).toContain('search_memories');
    expect(String(locked.systemInstruction)).toContain('call search_memories');
    expect(capable.data.tools).toEqual(['search_memories']);
  });

  it('reports speaker full duplex for devices not on the denylist', async () => {
    vi.spyOn(geminiAuthClient.authTokens, 'create').mockResolvedValue({
      name: 'authTokens/d',
    } as any);
    const user = await createUserFixture();

    const {data} = await createEphemeralToken(user.id, undefined, undefined, {
      deviceModel: 'Pixel 8',
    });

    expect(data.speakerFullDuplex).toBe(true);
  });

  it('reports the turn detection it locked into the token', async () => {
    const create = vi
      .spyOn(geminiAuthClient.authTokens, 'create')
      .mockResolvedValue({name: 'authTokens/turns'} as any);
    const user = await createUserFixture();

    const {data} = await createEphemeralToken(user.id);

    const detection =
      create.mock.calls[0][0].config.liveConnectConstraints.config
        .realtimeInputConfig.automaticActivityDetection;
    expect(data.turnDetection).toEqual({
      variant: expect.any(String),
      silenceDurationMs: detection.silenceDurationMs,
      prefixPaddingMs: detection.prefixPaddingMs,
    });
  });

  it('locks call actions in for clients that send the call_actions capability', async () => {
    const create = vi
      .spyOn(geminiAuthClient.authTokens, 'create')
      .mockResolvedValue({name: 'authTokens/actions'} as any);
    const user = await createUserFixture();

    const {data} = await createEphemeralToken(user.id, undefined, undefined, {
      memoryTool: true,
      callActions: true,
    });

    const locked = create.mock.calls[0][0].config.liveConnectConstraints.config;
    const serialized = JSON.stringify(locked.tools);
    expect(serialized).toContain('end_call');
    expect(serialized).toContain('open_screen');
    expect(String(locked.systemInstruction)).toContain('CALL ACTIONS');
    expect(data.tools).toEqual([
      'search_memories',
      'end_call',
      'set_microphone',
      'open_screen',
    ]);
  });

  it('locks server tools in, and lists them for the app to forward, only for clients that can', async () => {
    const create = vi
      .spyOn(geminiAuthClient.authTokens, 'create')
      .mockResolvedValue({name: 'authTokens/server-tools'} as any);
    const user = await createUserFixture();

    const without = await createEphemeralToken(user.id, undefined, undefined, {
      memoryTool: true,
    });
    expect(without.data.serverTools).toEqual([]);
    expect(
      JSON.stringify(
        create.mock.calls[0][0].config.liveConnectConstraints.config.tools,
      ),
    ).not.toContain('update_profile');

    const {data} = await createEphemeralToken(user.id, undefined, undefined, {
      memoryTool: true,
      serverTools: true,
    });

    const locked = create.mock.calls[1][0].config.liveConnectConstraints.config;
    expect(JSON.stringify(locked.tools)).toContain('update_profile');
    expect(String(locked.systemInstruction)).toContain('APP ACTIONS');
    expect(data.serverTools).toEqual(['update_profile', 'open_story']);
    expect(data.tools).toEqual([
      'search_memories',
      'update_profile',
      'open_story',
    ]);
  });
});
