import {afterEach, describe, expect, it, vi} from 'vitest';
import {OpenAICompatProvider} from '../../src/services/ai/providers/openai-compat';

const reply = (status: number, body: unknown) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
  });
const ok = (text: string) =>
  reply(200, {choices: [{message: {content: text}}]});
const messages = [{role: 'user' as const, content: 'hi'}];

function provider(models: string[]) {
  return new OpenAICompatProvider({
    name: 'groq',
    baseUrl: 'https://example.test/v1/',
    apiKey: 'key',
    models,
  });
}

function sentModels(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.map(
    ([, init]) => JSON.parse((init as RequestInit).body as string).model,
  );
}

describe('OpenAICompatProvider', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends the configured model', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok('hello'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      provider(['openai/gpt-oss-20b']).generateText(messages),
    ).resolves.toBe('hello');
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://example.test/v1/chat/completions',
    );
    expect(sentModels(fetchMock)).toEqual(['openai/gpt-oss-20b']);
  });

  it('tries the fallback model when the first one is retired', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(reply(404, {error: {code: 'model_not_found'}}))
      .mockResolvedValueOnce(ok('from fallback'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      provider(['old-model', 'new-model']).generateText(messages),
    ).resolves.toBe('from fallback');
    expect(sentModels(fetchMock)).toEqual(['old-model', 'new-model']);
  });

  it('does not switch models on a rate limit', async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(429, 'slow down'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      provider(['a', 'b']).generateText(messages),
    ).rejects.toMatchObject({status: 429});
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails with the last error when every model is unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(reply(404, 'model_not_found')),
    );
    await expect(
      provider(['a', 'b']).generateText(messages),
    ).rejects.toMatchObject({status: 404});
  });

  it('asks each distinct model once', async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(404, 'gone'));
    vi.stubGlobal('fetch', fetchMock);

    await provider(['same', 'same'])
      .generateText(messages)
      .catch(() => undefined);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
