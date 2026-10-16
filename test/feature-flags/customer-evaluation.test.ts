import express from 'express';
import request from 'supertest';
import {afterAll, afterEach, beforeAll, expect, it} from 'vitest';
import routes from '../../src/module/api/feature-flag/routes';
import errorHandler from '../../src/middleware/error-handler';
import {
  FeatureDefinition,
  FeatureOverride,
} from '../../src/module/database/model/feature-flag';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';
import {createUserFixture, issueLegacyAccessToken} from '../helpers/factories';
const app = express();
app.use(express.json());
app.use('/feature-flags', routes);
app.use(errorHandler);
beforeAll(connectTestDatabase);
afterEach(clearTestDatabase);
afterAll(closeTestDatabase);
it('requires authentication for evaluated flags', async () => {
  expect((await request(app).get('/feature-flags/evaluated')).status).toBe(401);
});
it('returns only the current customer’s evaluated values without internal descriptions', async () => {
  const user = await createUserFixture();
  const other = await createUserFixture({email: 'other-flags@example.com'});
  await FeatureDefinition.create({
    key: 'memory.create',
    domain: 'memory',
    default_value: false,
    description: 'private operator note',
  });
  await FeatureOverride.create({
    key: 'memory.create',
    scope_type: 'user',
    scope_id: String(other._id),
    value: true,
  });
  const authorization = `Bearer ${issueLegacyAccessToken(user)}`;
  const response = await request(app)
    .get('/feature-flags/evaluated')
    .set('Authorization', authorization);
  expect(response.status).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.body.data['memory.create']).toEqual({
    enabled: false,
    source: 'default',
  });
  expect(JSON.stringify(response.body)).not.toContain('private operator note');
  await FeatureOverride.create({
    key: 'memory.create',
    scope_type: 'user',
    scope_id: String(user._id),
    value: true,
  });
  const updated = await request(app)
    .get('/feature-flags/evaluated')
    .set('Authorization', authorization);
  expect(updated.body.data['memory.create']).toEqual({
    enabled: true,
    source: 'user',
  });
});
