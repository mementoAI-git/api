import request from 'supertest';
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';

vi.mock('../../src/module/api/billing/service', async importOriginal => ({
  ...(await importOriginal<
    typeof import('../../src/module/api/billing/service')
  >()),
  assertAccess: vi.fn().mockResolvedValue(undefined),
}));

import {assertAccess} from '../../src/module/api/billing/service';
import {throwSubscriptionRequired} from '../../src/module/api/billing/access';
import User from '../../src/module/database/model/user';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';
import {createTestApp} from '../helpers/app';
import {createUserFixture, issueLegacyAccessToken} from '../helpers/factories';

describe('POST /ai/voice/tools/:name', () => {
  beforeAll(connectTestDatabase);
  afterEach(clearTestDatabase);
  afterAll(closeTestDatabase);

  it('runs the tool as the signed-in host and returns its result and effects', async () => {
    const user = await createUserFixture();

    const res = await request(createTestApp())
      .post('/ai/voice/tools/update_profile')
      .set('Authorization', `Bearer ${issueLegacyAccessToken(user)}`)
      .send({args: {nickname: 'Yo'}});

    expect(res.status).toBe(200);
    expect(res.body.data.result).toMatch(/Yo/);
    expect(res.body.data.effects).toContainEqual({
      type: 'open',
      destination: 'profile',
    });
    expect((await User.findById(user.id).lean())?.nickname).toBe('Yo');
    expect(assertAccess).toHaveBeenCalledWith(user.id, 'voice_mode');
  });

  it('answers 404 for a tool that does not exist', async () => {
    const user = await createUserFixture();

    const res = await request(createTestApp())
      .post('/ai/voice/tools/delete_account')
      .set('Authorization', `Bearer ${issueLegacyAccessToken(user)}`)
      .send({args: {}});

    expect(res.status).toBe(404);
  });

  it('requires voice mode access', async () => {
    vi.mocked(assertAccess).mockImplementationOnce(async () =>
      throwSubscriptionRequired('voice_mode'),
    );
    const user = await createUserFixture();

    const res = await request(createTestApp())
      .post('/ai/voice/tools/update_profile')
      .set('Authorization', `Bearer ${issueLegacyAccessToken(user)}`)
      .send({args: {nickname: 'Yo'}});

    expect(res.status).toBe(402);
  });

  it('requires sign-in', async () => {
    const res = await request(createTestApp())
      .post('/ai/voice/tools/update_profile')
      .send({args: {nickname: 'Yo'}});

    expect(res.status).toBe(401);
  });

  it.each([
    ['UPDATE', {args: {}}],
    ['update_profile', {args: {}, extra: 1}],
    ['update_profile', {args: 'nope'}],
  ])('rejects invalid requests %#', async (name, body) => {
    const user = await createUserFixture();

    const res = await request(createTestApp())
      .post(`/ai/voice/tools/${name}`)
      .set('Authorization', `Bearer ${issueLegacyAccessToken(user)}`)
      .send(body);

    expect(res.status).toBe(422);
  });
});
