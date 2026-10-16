import request from 'supertest';
import {describe, expect, it} from 'vitest';
import {createTestApp} from '../helpers/app';

describe('readiness', () => {
  it('reports unavailable dependencies without exposing connection details', async () => {
    const response = await request(createTestApp()).get('/ready');

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      status: 503,
      success: false,
      code: 'service_unavailable',
      details: {
        status: 'not_ready',
        dependencies: expect.any(Object),
      },
    });
    expect(JSON.stringify(response.body)).not.toMatch(
      /redis:\/\/|mongodb:\/\//i,
    );
  });

  it('keeps aggregate operational signals behind authentication', async () => {
    const response = await request(createTestApp()).get('/staff/metrics');

    expect(response.status).toBe(401);
  });
});
