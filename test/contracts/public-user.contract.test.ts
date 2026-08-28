import request from 'supertest';
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import {toPublicUser} from '../../src/contracts/public-user';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';
import {createUserFixture, issueLegacyAccessToken} from '../helpers/factories';
import {createTestApp} from '../helpers/app';

const sensitiveKeys = [
  'password',
  'private_key',
  'public_key',
  'refresh_token',
  'refresh_tokens',
  'context',
];

describe('public user contract', () => {
  beforeAll(connectTestDatabase);
  afterEach(clearTestDatabase);
  afterAll(closeTestDatabase);

  it('uses an allowlist while retaining safe client compatibility metadata', async () => {
    const user = await createUserFixture({
      private_key: 'private-account-key',
      public_key: 'public-account-key',
      refresh_token: 'raw-refresh-token',
      refresh_tokens: ['raw-refresh-token'],
      providers: ['password'],
      preferences: {communication_style: 'friendly'},
      two_factor: {enabled: true, secret: 'totp-secret'},
      passkeys: [
        {
          credential_id: 'credential-id',
          public_key: 'passkey-public-key',
          counter: 8,
          device_name: 'Phone',
          created_at: new Date('2026-01-01T00:00:00.000Z'),
        },
      ],
    });

    const dto = toPublicUser(user.toObject({virtuals: true}));

    expect(dto).toMatchObject({
      id: user.id,
      _id: user.id,
      email: user.email,
      providers: ['password'],
      preferences: {communication_style: 'friendly'},
      two_factor: {enabled: true},
      passkeys: [
        {
          credential_id: 'credential-id',
          device_name: 'Phone',
          created_at: new Date('2026-01-01T00:00:00.000Z'),
        },
      ],
    });
    for (const key of sensitiveKeys) expect(dto).not.toHaveProperty(key);
    expect(dto.two_factor).not.toHaveProperty('secret');
    expect(dto.passkeys?.[0]).not.toHaveProperty('public_key');
    expect(dto.passkeys?.[0]).not.toHaveProperty('counter');
  });

  it('returns the same safe projection from the profile endpoint', async () => {
    const user = await createUserFixture({
      private_key: 'private-account-key',
      public_key: 'public-account-key',
      refresh_token: 'raw-refresh-token',
      refresh_tokens: ['raw-refresh-token'],
      two_factor: {enabled: true, secret: 'totp-secret'},
      passkeys: [
        {
          credential_id: 'credential-id',
          public_key: 'passkey-public-key',
          counter: 2,
          device_name: 'Laptop',
          created_at: new Date(),
        },
      ],
    });

    const response = await request(createTestApp())
      .get('/users/profile')
      .set('Authorization', `Bearer ${issueLegacyAccessToken(user)}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      id: user.id,
      email: user.email,
      primary_conversation_id: null,
      two_factor: {enabled: true},
      passkeys: [{credential_id: 'credential-id', device_name: 'Laptop'}],
      pending_insights_count: 0,
    });
    for (const key of sensitiveKeys) {
      expect(response.body.data).not.toHaveProperty(key);
    }
    expect(response.body.data.two_factor).not.toHaveProperty('secret');
    expect(response.body.data.passkeys[0]).not.toHaveProperty('public_key');
    expect(response.body.data.passkeys[0]).not.toHaveProperty('counter');
  });
});
