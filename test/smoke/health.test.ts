import request from 'supertest';
import {describe, expect, it} from 'vitest';
import {createTestApp} from '../helpers/app';

describe('health', () => {
  it('creates the Express app without binding a port', async () => {
    const response = await request(createTestApp()).get('/health');

    expect(response.status).toBe(200);
    expect(response.body.data.message).toBe('OK');
  });
});
