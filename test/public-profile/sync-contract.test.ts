import request from 'supertest';
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
vi.mock('../../src/utils/config', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/utils/config')>()),
  FRONTEND_URL: 'https://web.test',
}));
import {createTestApp} from '../helpers/app';
import {
  connectTestDatabase,
  clearTestDatabase,
  closeTestDatabase,
} from '../helpers/database';
import {createUserFixture, issueLegacyAccessToken} from '../helpers/factories';
import {publishProfile} from '../../src/module/api/public-profile/service';
import {toPublicUser} from '../../src/contracts/public-user';

describe('profile compatibility after GitHub synchronization', () => {
  beforeAll(connectTestDatabase);
  afterEach(clearTestDatabase);
  afterAll(closeTestDatabase);

  it('retains banner metadata through the safe profile response without exposing secrets', () => {
    const profile = toPublicUser({
      _id: 'owner',
      banner: 'cover.webp',
      banner_preset: 2,
      banner_position: {x: 30, y: 70},
      password: 'private-password',
      private_key: 'private-key',
    });
    expect(profile).toMatchObject({
      banner: 'cover.webp',
      banner_preset: 2,
      banner_position: {x: 30, y: 70},
      banner_url: 'http://localhost:5000/files/cover.webp',
    });
    expect(profile).not.toHaveProperty('password');
    expect(profile).not.toHaveProperty('private_key');
  });

  it('registers the published profile route in the full API and preserves default avatar URLs', async () => {
    const user = await createUserFixture({
      picture: 'https://avatar.test/default.svg',
    });
    const {token} = await publishProfile(user.id);
    const response = await request(createTestApp()).get(
      `/public/profiles/${token}`,
    );
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.text).toContain('https://avatar.test/default.svg');
  });

  it('requires authentication to publish a profile', async () => {
    const user = await createUserFixture();
    const response = await request(createTestApp()).post(
      '/users/profile/share',
    );
    expect(response.status).toBe(401);
    const signedIn = await request(createTestApp())
      .post('/users/profile/share')
      .set('Authorization', `Bearer ${issueLegacyAccessToken(user)}`);
    expect(signedIn.status).toBe(200);
    expect(signedIn.body.data.token).toMatch(/^[a-f0-9-]{36}$/);
  });
});
