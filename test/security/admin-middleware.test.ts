import express from 'express';
import request from 'supertest';
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import gaurd from '../../src/middleware/gaurd';
import {requireAdmin} from '../../src/middleware/admin';
import errorHandler from '../../src/middleware/error-handler';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';
import {createUserFixture, issueLegacyAccessToken} from '../helpers/factories';

function createAdminTestApp() {
  const app = express();
  app.get('/admin', gaurd, requireAdmin, (_req, res) => res.sendStatus(204));
  app.use(errorHandler);
  return app;
}

describe('administrator middleware', () => {
  beforeAll(connectTestDatabase);
  afterEach(clearTestDatabase);
  afterAll(closeTestDatabase);

  it('requires authentication', async () => {
    const response = await request(createAdminTestApp()).get('/admin');
    expect(response.status).toBe(401);
  });

  it('rejects an ordinary active user', async () => {
    const user = await createUserFixture();
    const response = await request(createAdminTestApp())
      .get('/admin')
      .set('Authorization', `Bearer ${issueLegacyAccessToken(user)}`);
    expect(response.status).toBe(403);
  });

  it('rejects customer credentials even on the former email allowlist', async () => {
    const admin = await createUserFixture({email: 'admin@example.com'});
    const response = await request(createAdminTestApp())
      .get('/admin')
      .set('Authorization', `Bearer ${issueLegacyAccessToken(admin)}`);
    expect(response.status).toBe(403);
  });

  it('rejects a deleted allowlisted user', async () => {
    const deleted = await createUserFixture({
      email: 'admin@example.com',
      deleted: true,
    });
    const response = await request(createAdminTestApp())
      .get('/admin')
      .set('Authorization', `Bearer ${issueLegacyAccessToken(deleted)}`);
    expect(response.status).toBe(401);
  });
});
