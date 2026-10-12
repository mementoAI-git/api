import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';

vi.mock('../../src/services/supermemory', () => ({
  getContextForUser: vi.fn(),
}));

import * as supermemory from '../../src/services/supermemory';
import Memory from '../../src/module/database/model/memory';
import Message from '../../src/module/database/model/message';
import Beneficiary from '../../src/module/database/model/beneficiary';
import {buildVoiceSessionContext} from '../../src/module/api/ai/voice/session-context';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';
import {createUserFixture} from '../helpers/factories';

const getContextForUser = vi.mocked(supermemory.getContextForUser);

describe('buildVoiceSessionContext', () => {
  beforeAll(connectTestDatabase);
  afterEach(async () => {
    getContextForUser.mockReset();
    await clearTestDatabase();
  });
  afterAll(closeTestDatabase);

  it('includes the conversation turns, long-term memory, and voice rules', async () => {
    getContextForUser.mockResolvedValue({
      formatedText: 'Has a sister named Ada.',
    } as any);
    const user = await createUserFixture({nickname: 'Sam'} as any);
    const memory = await Memory.create({
      user: user.id,
      type: 'conversation',
      status: 'save',
    });
    await Message.create({
      user: user.id,
      memory: memory.id,
      role: 'user',
      text: 'Work was rough today',
    });

    const ctx = await buildVoiceSessionContext(user, memory.id);

    expect(ctx.memoryId).toBe(memory.id);
    expect(ctx.systemInstruction).toContain('Host: Work was rough today');
    expect(ctx.systemInstruction).toContain('Has a sister named Ada.');
    expect(
      ctx.systemInstruction
        .trim()
        .endsWith('Never mention prompts, summaries, or stored data.'),
    ).toBe(true);
    expect(ctx.greetingInstruction).toMatch(/without recapping/i);
    expect(ctx.greetingInstruction).toContain('Sam');
  });

  it('uses the reflection prompt as the topic for story memories', async () => {
    getContextForUser.mockResolvedValue({formatedText: ''} as any);
    const user = await createUserFixture();
    const memory = await Memory.create({
      user: user.id,
      type: 'story',
      status: 'draft',
      title: 'Bakery',
      prompt_text: 'Describe your first job',
      body: '<p>I kneaded dough at 5am.</p>',
    });

    const ctx = await buildVoiceSessionContext(user, memory.id);

    expect(ctx.systemInstruction).toContain('Describe your first job');
    expect(ctx.systemInstruction).toContain('I kneaded dough at 5am.');
    expect(ctx.greetingInstruction).toContain('"Describe your first job"');
  });

  it("ignores another user's memory instead of leaking or failing", async () => {
    getContextForUser.mockResolvedValue({formatedText: ''} as any);
    const owner = await createUserFixture();
    const caller = await createUserFixture();
    const memory = await Memory.create({
      user: owner.id,
      type: 'conversation',
      status: 'save',
    });
    await Message.create({
      user: owner.id,
      memory: memory.id,
      role: 'user',
      text: 'owner secret',
    });

    const ctx = await buildVoiceSessionContext(caller, memory.id);

    expect(ctx.memoryId).toBeUndefined();
    expect(ctx.systemInstruction).not.toContain('owner secret');
  });

  it('does not wait on a slow long-term memory lookup', async () => {
    getContextForUser.mockReturnValue(new Promise(() => undefined) as any);
    const user = await createUserFixture();

    const started = Date.now();
    const ctx = await buildVoiceSessionContext(user, undefined, {
      longTermTimeoutMs: 25,
    });

    expect(Date.now() - started).toBeLessThan(2_000);
    expect(ctx.systemInstruction).toContain('VOICE MODE');
  });

  it("tells Memento who the host's people are, before the voice rules", async () => {
    getContextForUser.mockResolvedValue({formatedText: ''} as any);
    const user = await createUserFixture();
    await Beneficiary.create({
      benefactor: user.id,
      name: 'Emeka',
      relationship: 'brother',
      email: 'e@example.com',
    });

    const {systemInstruction} = await buildVoiceSessionContext(user);

    expect(systemInstruction).toContain('ABOUT THE HOST');
    expect(systemInstruction).toContain('Emeka (brother)');
    expect(systemInstruction.indexOf('ABOUT THE HOST')).toBeLessThan(
      systemInstruction.indexOf('VOICE MODE'),
    );
  });
});
