import request from 'supertest';
import {describe, expect, it} from 'vitest';
import {createTestApp} from '../helpers/app';

describe('success response contract', () => {
  it('preserves legacy fields while adding the canonical envelope', async () => {
    const response = await request(createTestApp()).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: 200,
      success: true,
      message: 'OK',
      data: {message: 'OK'},
      meta: {
        contract_version: '2026-08',
        request_id: expect.any(String),
      },
    });
    expect(response.headers['x-request-id']).toBe(
      response.body.meta.request_id,
    );
  });
});
