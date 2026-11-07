import request from 'supertest';
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';

vi.mock('../../src/module/api/feature-flag/service', async importOriginal => ({
  ...(await importOriginal<
    typeof import('../../src/module/api/feature-flag/service')
  >()),
  evaluateFeatureFlag: vi.fn(async () => ({enabled: true, source: 'test'})),
}));
vi.mock('../../src/module/api/ai/service', async importOriginal => {
  const actual =
    await importOriginal<typeof import('../../src/module/api/ai/service')>();
  return {
    ...actual,
    prompt: vi.fn(
      async (
        _payload: unknown,
        _user: string,
        _features: unknown,
        onStatus?: (text: string) => void,
      ) => {
        onStatus?.('Looking through your stories…');
        return {
          stream: (async function* () {
            yield {text: 'You wrote about Lagos.'};
          })(),
          modelLabel: 'groq:test',
          userText: 'what did I write about Lagos?',
          userMessageSaved: Promise.resolve(false),
        };
      },
    ),
    handleStreaming: vi.fn(
      async (
        _user: string,
        _memory: string,
        stream: AsyncGenerator<{text?: string}>,
        res: import('express').Response,
      ) => {
        for await (const chunk of stream) res.write(chunk.text ?? '');
        res.end();
      },
    ),
  };
});

import * as service from '../../src/module/api/ai/service';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';
import {createTestApp} from '../helpers/app';
import {createUserFixture, issueLegacyAccessToken} from '../helpers/factories';

const MEMORY = '64b7f0c2a1b2c3d4e5f60733';

function body(res: {text?: string; body?: unknown}) {
  return res.text ?? String(res.body ?? '');
}

describe('POST /ai/prompt status lines', () => {
  beforeAll(connectTestDatabase);
  afterEach(clearTestDatabase);
  afterAll(closeTestDatabase);

  it('sends status and model frames before the reply to apps that ask for them', async () => {
    const user = await createUserFixture();
    const res = await request(createTestApp())
      .post('/ai/prompt')
      .set('Authorization', `Bearer ${issueLegacyAccessToken(user)}`)
      .set('X-Memento-Chat-Features', 'links,cards,status')
      .buffer(true)
      .parse((response, done) => {
        let data = '';
        response.on('data', chunk => (data += chunk));
        response.on('end', () => done(null, data));
      })
      .send({text: 'what did I write about Lagos?', memory: MEMORY});

    expect(res.status).toBe(200);
    expect(res.body).toBe(
      '\u001e{"status":"Looking through your stories…"}\n' +
        '\u001e{"model":"groq:test"}\n' +
        'You wrote about Lagos.',
    );
    expect(vi.mocked(service.prompt).mock.calls[0][2]).toMatchObject({
      status: true,
      links: true,
      cards: true,
    });
  });

  it('keeps the plain stream for apps that do not ask, like older mobile builds', async () => {
    const user = await createUserFixture();
    const res = await request(createTestApp())
      .post('/ai/prompt')
      .set('Authorization', `Bearer ${issueLegacyAccessToken(user)}`)
      .set('X-Memento-Client', 'ios')
      .send({text: 'what did I write about Lagos?', memory: MEMORY});

    expect(body(res)).toBe('You wrote about Lagos.');
    expect(res.headers['x-ai-model']).toBe('groq:test');
    expect(vi.mocked(service.prompt).mock.calls.at(-1)?.[2]).toEqual({
      links: false,
      cards: false,
      status: false,
    });
  });
});
