import express from 'express';
import {StatusCodes} from 'http-status-codes';
import request from 'supertest';
import {describe, expect, it} from 'vitest';
import errorHandler from '../../src/middleware/error-handler';
import rateLimiter from '../../src/middleware/rate-limiter';
import requestContext from '../../src/middleware/request-context';
import {ServiceError} from '../../src/utils/service-error';
import {createTestApp} from '../helpers/app';

function errorApp(error: unknown) {
  const app = express();
  app.use(requestContext);
  app.get('/', () => {
    throw error;
  });
  app.use(errorHandler);
  return app;
}

describe('error response contract', () => {
  it('adds stable validation fields while retaining legacy error data', async () => {
    const response = await request(createTestApp())
      .post('/auth/register')
      .send({});

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({
      status: 422,
      success: false,
      message: expect.any(String),
      code: 'validation_failed',
      details: {errors: expect.any(Array)},
      data: expect.any(Array),
      request_id: response.headers['x-request-id'],
    });
  });

  it('returns a canonical authentication error', async () => {
    const response = await request(createTestApp()).get('/users/profile');

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({
      status: 401,
      success: false,
      code: 'unauthorized',
      request_id: response.headers['x-request-id'],
    });
  });

  it('returns a canonical not-found response for unmatched routes', async () => {
    const response = await request(createTestApp()).get('/missing-route');

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      status: 404,
      success: false,
      code: 'not_found',
      request_id: response.headers['x-request-id'],
    });
  });

  it('preserves legacy payment gate fields at the top level and in data', async () => {
    const gate = {feature: 'attachments.doc_upload', requiredTier: 'pro'};
    const response = await request(
      errorApp(
        new ServiceError(
          'Upgrade required',
          StatusCodes.PAYMENT_REQUIRED,
          gate,
        ),
      ),
    ).get('/');

    expect(response.body).toMatchObject({
      status: 402,
      success: false,
      code: 'payment_required',
      details: gate,
      data: gate,
      ...gate,
    });
  });

  it('maps upload limits and unexpected errors without exposing stacks', async () => {
    const multerResponse = await request(
      errorApp({
        name: 'MulterError',
        code: 'LIMIT_FILE_SIZE',
        message: 'large',
      }),
    ).get('/');
    const unknownResponse = await request(errorApp(new Error('private'))).get(
      '/',
    );

    expect(multerResponse.body).toMatchObject({
      status: 413,
      success: false,
      code: 'payload_too_large',
    });
    expect(unknownResponse.body).toMatchObject({
      status: 500,
      success: false,
      message: 'Internal server error',
      code: 'internal_error',
    });
    expect(JSON.stringify(unknownResponse.body)).not.toContain('stack');
  });

  it('uses the canonical envelope for dedicated rate limits', async () => {
    const app = express();
    app.set('trust proxy', 1);
    app.use(requestContext);
    app.get('/', rateLimiter(1, 1), (_req, res) => res.sendStatus(204));

    expect((await request(app).get('/')).status).toBe(204);
    const response = await request(app).get('/');
    expect(response.status).toBe(429);
    expect(response.body).toMatchObject({
      status: 429,
      success: false,
      code: 'rate_limited',
      request_id: response.headers['x-request-id'],
    });
  });
});
