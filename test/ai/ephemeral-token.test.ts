import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';

vi.mock('../../src/services/supermemory', () => ({
  getContextForUser: vi.fn().mockResolvedValue({formatedText: ''}),
}));

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

  it('locks the resume handle into the token when reconnecting', async () => {
    const create = vi
      .spyOn(geminiAuthClient.authTokens, 'create')
      .mockResolvedValue({name: 'authTokens/resume'} as any);
    const user = await createUserFixture();

    await createEphemeralToken(user.id, undefined, 'handle-abc');

    const locked = create.mock.calls[0][0].config.liveConnectConstraints.config;
    expect(locked.sessionResumption).toEqual({handle: 'handle-abc'});
  });
});
