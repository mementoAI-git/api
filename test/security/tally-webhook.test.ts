import {createHmac} from 'crypto';
import express from 'express';
import request from 'supertest';
import {describe, expect, it} from 'vitest';
import {createTestApp} from '../helpers/app';
import errorHandler from '../../src/middleware/error-handler';
import {createWebhookRouter} from '../../src/module/api/webhook/routes';
import {verifyTallySignature} from '../../src/module/api/webhook/service';

const SECRET = 'test-tally-webhook-secret-at-least-32-characters';
const compactBody = '{"eventId":"event-1","data":{"fields":[]}}';
const spacedBody = '{ "eventId": "event-1", "data": { "fields": [] } }';

function signature(body: string): string {
  return createHmac('sha256', SECRET).update(body).digest('base64');
}

async function send(body: string, tallySignature?: string) {
  let pending = request(createTestApp())
    .post('/webhooks/tally')
    .set('Content-Type', 'application/json');
  if (tallySignature) pending = pending.set('Tally-Signature', tallySignature);
  return pending.send(body);
}

describe('Tally webhook verification', () => {
  it('fails closed when the signing secret is absent', () => {
    expect(() =>
      verifyTallySignature(
        Buffer.from(compactBody),
        signature(compactBody),
        '',
      ),
    ).toThrow('not configured');
  });

  it('rejects a missing signature', async () => {
    expect((await send(compactBody)).status).toBe(401);
  });

  it('rejects a tampered signature', async () => {
    expect((await send(compactBody, 'invalid')).status).toBe(401);
  });

  it.each([compactBody, spacedBody])(
    'accepts an HMAC over the exact raw JSON bytes',
    async body => {
      const response = await send(body, signature(body));
      expect(response.status).toBe(200);
      expect(response.body.data.inviteSent).toBe(false);
    },
  );

  it('does not accept a signature over a reserialized equivalent body', async () => {
    const response = await send(spacedBody, signature(compactBody));
    expect(response.status).toBe(401);
  });

  it('rate limits repeated webhook attempts', async () => {
    const app = express();
    app.set('trust proxy', 1);
    app.use(
      express.json({
        verify: (req, _res, body) => {
          (req as express.Request & {rawBody?: Buffer}).rawBody = body;
        },
      }),
    );
    app.use(
      '/webhooks',
      createWebhookRouter({tallyEnabled: true, tallyRateLimitPerMinute: 1}),
    );
    app.use(errorHandler);

    const first = await request(app)
      .post('/webhooks/tally')
      .set('Content-Type', 'application/json')
      .set('Tally-Signature', signature(compactBody))
      .send(compactBody);
    const second = await request(app)
      .post('/webhooks/tally')
      .set('Content-Type', 'application/json')
      .set('Tally-Signature', signature(compactBody))
      .send(compactBody);

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
  });
});
