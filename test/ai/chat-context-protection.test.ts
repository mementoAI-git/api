import {describe, expect, it} from 'vitest';
import {
  buildGroqBoundedMessages,
  fitSystemPrompt,
  getGroqModelsForPrompt,
} from '../../src/services/ai/groq-chat-messages';
import {
  EMPTY_REPLY_MESSAGE,
  withEmptyReplyRecovery,
} from '../../src/services/ai/critical-chat-stream';
import {
  GROQ_MODEL_CHAT_FAST_PRIMARY,
  GROQ_MODEL_CHAT_PRIMARY,
} from '../../src/utils/config';

async function collect(stream: AsyncGenerator<{text?: string}>) {
  let text = '';
  for await (const chunk of stream) text += chunk.text ?? '';
  return text;
}

async function* chunks(...texts: string[]) {
  for (const text of texts) yield {text};
}

describe('fitting the system prompt', () => {
  it('leaves a prompt that fits untouched', () => {
    expect(fitSystemPrompt('policy', 100)).toBe('policy');
  });

  it('keeps the policy at the start and the lookups at the end, trimming the middle', () => {
    const prompt =
      'POLICY START ' +
      'stored memory '.repeat(5000) +
      'LOOKUPS FOR THIS MESSAGE: no story mentions Memento. REPLY FORMAT';
    const fitted = fitSystemPrompt(prompt, 35_000);

    expect(fitted.length).toBeLessThanOrEqual(35_000);
    expect(fitted.startsWith('POLICY START')).toBe(true);
    expect(fitted).toContain('no story mentions Memento');
    expect(fitted.endsWith('REPLY FORMAT')).toBe(true);
    expect(fitted).toContain('Some older reference context was left out');
  });
});

describe('conversation history for Groq', () => {
  const turns = (count: number) =>
    Array.from({length: count}, (_, i) => ({
      role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant',
      content: `turn ${i}`,
    }));

  it('keeps about ten exchanges word for word', () => {
    const messages = buildGroqBoundedMessages({
      systemInstruction: 'policy',
      history: turns(20),
      userText: 'now',
    });
    expect(messages).toHaveLength(22);
    expect(messages.map(m => m.content)).toContain('turn 0');
  });

  it('passes older turns as a note, not as something Memento said', () => {
    const messages = buildGroqBoundedMessages({
      systemInstruction: 'policy',
      history: turns(24),
      userText: 'now',
    });
    expect(messages[1].role).toBe('system');
    expect(messages[1].content).toContain('Summary of earlier');
  });
});

describe('choosing the Groq model', () => {
  it('uses the fast model only to open a conversation', () => {
    expect(getGroqModelsForPrompt('hey').primaryModel).toBe(
      GROQ_MODEL_CHAT_FAST_PRIMARY,
    );
    expect(
      getGroqModelsForPrompt('You there?', {hasHistory: true}).primaryModel,
    ).toBe(GROQ_MODEL_CHAT_PRIMARY);
  });
});

describe('a reply that comes back empty', () => {
  it('passes a normal reply through without asking again', async () => {
    let asked = false;
    const text = await collect(
      withEmptyReplyRecovery(chunks('Hi ', 'there'), async () => {
        asked = true;
        return 'again';
      }),
    );
    expect(text).toBe('Hi there');
    expect(asked).toBe(false);
  });

  it('asks again when the stream ends with no text', async () => {
    const reasons: string[] = [];
    const text = await collect(
      withEmptyReplyRecovery(
        chunks('', '  '),
        async () => 'What are you building?',
        reason => reasons.push(reason),
      ),
    );
    expect(text).toContain('What are you building?');
    expect(reasons).toEqual(['empty_stream']);
  });

  it('asks again when the stream fails before any text', async () => {
    async function* failing(): AsyncGenerator<{text?: string}> {
      yield {text: ''};
      throw new Error('connection reset');
    }
    const text = await collect(
      withEmptyReplyRecovery(failing(), async () => 'Recovered.'),
    );
    expect(text).toBe('Recovered.');
  });

  it('never leaves the host with nothing', async () => {
    const text = await collect(
      withEmptyReplyRecovery(chunks(''), async () => {
        throw new Error('down');
      }),
    );
    expect(text).toBe(EMPTY_REPLY_MESSAGE);
  });
});
