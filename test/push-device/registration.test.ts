import {createHash} from 'crypto';
import request from 'supertest';
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import PushDevice from '../../src/module/database/model/push-device';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';
import {createTestApp} from '../helpers/app';
import {createUserFixture, issueLegacyAccessToken} from '../helpers/factories';

describe('push device registration', () => {
  beforeAll(connectTestDatabase);
  afterEach(clearTestDatabase);
  afterAll(closeTestDatabase);

  it('idempotently creates and updates an installation for its owner', async () => {
    const user = await createUserFixture();
    const token = issueLegacyAccessToken(user);
    const app = createTestApp();

    const created = await request(app)
      .put('/push-devices/install-123')
      .set('Authorization', `Bearer ${token}`)
      .send({platform: 'ios', push_token: 'ExponentPushToken[first]'});
    const updated = await request(app)
      .put('/push-devices/install-123')
      .set('Authorization', `Bearer ${token}`)
      .send({platform: 'ios', push_token: 'ExponentPushToken[second]'});

    expect(created.status).toBe(200);
    expect(updated.status).toBe(200);
    expect(updated.body.data).toMatchObject({
      installation_id: 'install-123',
      platform: 'ios',
      enabled: true,
    });
    expect(updated.body.data).not.toHaveProperty('push_token');
    expect(await PushDevice.countDocuments({user_id: user.id})).toBe(1);
    const stored = await PushDevice.findOne({user_id: user.id}).select(
      '+push_token',
    );
    expect(stored?.push_token).toBe('ExponentPushToken[second]');
  });

  it('rejects reassignment of an installation owned by another user', async () => {
    const first = await createUserFixture();
    const second = await createUserFixture();
    const app = createTestApp();

    expect(
      (
        await request(app)
          .put('/push-devices/shared-install')
          .set('Authorization', `Bearer ${issueLegacyAccessToken(first)}`)
          .send({platform: 'android', push_token: 'token-one'})
      ).status,
    ).toBe(200);

    const reassigned = await request(app)
      .put('/push-devices/shared-install')
      .set('Authorization', `Bearer ${issueLegacyAccessToken(second)}`)
      .send({platform: 'android', push_token: 'token-two'});

    expect(reassigned.status).toBe(409);
    expect(reassigned.body.code).toBe('conflict');
    expect(
      await PushDevice.countDocuments({installation_id: 'shared-install'}),
    ).toBe(1);
  });

  it('validates the platform and makes disablement idempotent', async () => {
    const user = await createUserFixture();
    const token = issueLegacyAccessToken(user);
    const app = createTestApp();

    const invalid = await request(app)
      .put('/push-devices/install-456')
      .set('Authorization', `Bearer ${token}`)
      .send({platform: 'desktop', push_token: 'token'});
    expect(invalid.status).toBe(422);

    await request(app)
      .put('/push-devices/install-456')
      .set('Authorization', `Bearer ${token}`)
      .send({platform: 'web', push_token: 'token'});
    const firstDelete = await request(app)
      .delete('/push-devices/install-456')
      .set('Authorization', `Bearer ${token}`);
    const secondDelete = await request(app)
      .delete('/push-devices/install-456')
      .set('Authorization', `Bearer ${token}`);

    expect(firstDelete.status).toBe(200);
    expect(secondDelete.status).toBe(200);
    expect(
      await PushDevice.findOne({
        user_id: user.id,
        installation_id: 'install-456',
      }),
    ).toMatchObject({enabled: false});
  });

  it('bridges legacy profile push tokens without exposing or storing them on users', async () => {
    const user = await createUserFixture();
    const pushToken = 'ExponentPushToken[legacy-device]';
    const installationId = `legacy-${createHash('sha256')
      .update(pushToken)
      .digest('hex')
      .slice(0, 24)}`;

    const response = await request(createTestApp())
      .put('/users/profile')
      .set('Authorization', `Bearer ${issueLegacyAccessToken(user)}`)
      .set('X-Memento-Client', 'ios')
      .send({push_token: pushToken});

    expect(response.status).toBe(200);
    expect(response.body.data).not.toHaveProperty('push_token');
    expect(
      await PushDevice.findOne({
        user_id: user.id,
        installation_id: installationId,
      }),
    ).toMatchObject({platform: 'ios', enabled: true});
  });

  it('rejects legacy push registration when platform cannot be inferred', async () => {
    const user = await createUserFixture();
    const response = await request(createTestApp())
      .put('/users/profile')
      .set('Authorization', `Bearer ${issueLegacyAccessToken(user)}`)
      .send({push_token: 'legacy-without-client'});

    expect(response.status).toBe(422);
  });
});
