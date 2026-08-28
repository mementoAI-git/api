import express, {type Request, type Response} from 'express';
import request from 'supertest';
import {describe, expect, it} from 'vitest';
import requestContext from '../../src/middleware/request-context';
import type {RequestContext} from '../../src/contracts/response';

function createContextApp() {
  const app = express();
  app.use(requestContext);
  app.get('/', (_req: Request, res: Response) => {
    res.json(res.locals.requestContext as RequestContext);
  });
  return app;
}

describe('request context', () => {
  it('captures supported non-sensitive client metadata', async () => {
    const response = await request(createContextApp())
      .get('/')
      .set('X-Memento-Client', 'ios')
      .set('X-Memento-Version', '2.4.0')
      .set('X-Memento-Build', '312');

    expect(response.body).toMatchObject({
      requestId: expect.any(String),
      client: 'ios',
      version: '2.4.0',
      build: '312',
    });
    expect(response.headers['x-request-id']).toBe(response.body.requestId);
  });

  it('classifies missing or invalid metadata as legacy unknown', async () => {
    const response = await request(createContextApp())
      .get('/')
      .set('X-Memento-Client', 'desktop')
      .set('X-Memento-Version', 'x'.repeat(129))
      .set('X-Memento-Build', 'x'.repeat(129));

    expect(response.body).toMatchObject({
      client: 'legacy-unknown',
      version: null,
      build: null,
    });
  });

  it('does not trust a caller-supplied request ID', async () => {
    const response = await request(createContextApp())
      .get('/')
      .set('X-Request-Id', 'caller-controlled');

    expect(response.body.requestId).not.toBe('caller-controlled');
    expect(response.body.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});
