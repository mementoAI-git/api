import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import User from '../../src/module/database/model/user';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';
import {createUserFixture, issueLegacyAccessToken} from '../helpers/factories';

describe('database test helpers', () => {
  beforeAll(connectTestDatabase);
  afterEach(clearTestDatabase);
  afterAll(closeTestDatabase);

  it('creates isolated users and legacy access tokens', async () => {
    const user = await createUserFixture({email: 'owner@example.com'});
    const token = issueLegacyAccessToken(user);

    expect(await User.countDocuments()).toBe(1);
    expect(user.email).toBe('owner@example.com');
    expect(token).toMatch(/^ey/);
  });

  it('starts with an empty database after each test', async () => {
    expect(await User.countDocuments()).toBe(0);
  });
});
