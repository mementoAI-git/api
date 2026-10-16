import {afterEach, describe, expect, it, vi} from 'vitest';

vi.mock('../../src/services/embeddings/long-term', () => ({
  getLongTermContext: vi.fn(),
}));
vi.mock('../../src/module/api/ai/voice/host-overview', () => ({
  buildHostOverview: vi.fn(async () => 'ABOUT THE HOST: test'),
}));
vi.mock('../../src/module/api/ai/voice/transcript-context', () => ({
  getRecentConversationLines: vi.fn(async () => [
    {speaker: 'Host', text: 'Emeka is moving to Toronto'},
  ]),
  formatTranscriptLines: vi.fn(() => ''),
}));
vi.mock('../../src/module/api/memory/access', () => ({
  findOwnedMemory: vi.fn(async () => ({_id: 'chat-1', type: 'conversation'})),
}));
vi.mock('../../src/utils', () => ({
  prompts: {
    createSystemContext: vi.fn(
      async (
        _user: unknown,
        _memory: unknown,
        _persona: unknown,
        longTerm: string,
      ) => `BASE\n${longTerm}\nEND`,
    ),
  },
}));

import {getLongTermContext} from '../../src/services/embeddings/long-term';
import {prompts} from '../../src/utils';
import {buildVoiceSessionContext} from '../../src/module/api/ai/voice/session-context';

const user = {_id: 'host', first_name: 'Ada'} as never;

describe('voice session context', () => {
  afterEach(() => vi.clearAllMocks());

  it('builds the base context without waiting for the recall, then fills it in', async () => {
    let recalled!: (value: string) => void;
    vi.mocked(getLongTermContext).mockReturnValue(
      new Promise(resolve => (recalled = resolve)),
    );

    const ready = buildVoiceSessionContext(user, 'chat-1', {
      longTermTimeoutMs: 5_000,
    });
    // The base is requested while the recall is still pending.
    await vi.waitFor(() =>
      expect(prompts.createSystemContext).toHaveBeenCalled(),
    );
    expect(getLongTermContext).toHaveBeenCalledWith(
      'host',
      'Emeka is moving to Toronto',
    );
    recalled('FROM THEIR OWN PAST WORDS: Emeka got his visa');

    const {systemInstruction} = await ready;
    expect(systemInstruction).toContain(
      'BASE\nFROM THEIR OWN PAST WORDS: Emeka got his visa\nEND',
    );
    expect(systemInstruction).not.toContain('\u0000');
  });

  it('uses the compact context only when the app can search memories', async () => {
    vi.mocked(getLongTermContext).mockResolvedValue('');
    await buildVoiceSessionContext(user, 'chat-1', {memoryTool: true});
    await buildVoiceSessionContext(user, 'chat-1', {memoryTool: false});

    const compactFlags = vi
      .mocked(prompts.createSystemContext)
      .mock.calls.map(call => (call as unknown[])[5]);
    expect(compactFlags).toEqual([{compact: true}, {compact: false}]);
  });

  it('leaves the block empty when the recall times out', async () => {
    vi.mocked(getLongTermContext).mockReturnValue(new Promise(() => {}));

    const {systemInstruction} = await buildVoiceSessionContext(user, 'chat-1', {
      longTermTimeoutMs: 50,
    });

    expect(systemInstruction).toContain('BASE\n\nEND');
    expect(systemInstruction).not.toContain('\u0000');
  });
});
