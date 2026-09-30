import request from 'supertest';
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';

vi.mock('../../src/services/supermemory', () => ({
  getContextForUser: vi.fn().mockResolvedValue({formatedText: ''}),
}));
vi.mock('../../src/module/api/billing/service', async importOriginal => ({
  ...(await importOriginal<
    typeof import('../../src/module/api/billing/service')
  >()),
  assertAccess: vi.fn().mockResolvedValue(undefined),
}));

import {assertAccess} from '../../src/module/api/billing/service';
import {throwSubscriptionRequired} from '../../src/module/api/billing/access';
import Memory from '../../src/module/database/model/memory';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';
import {createTestApp} from '../helpers/app';
import {createUserFixture, issueLegacyAccessToken} from '../helpers/factories';

describe('POST /ai/voice/memory-search', () => {
  beforeAll(connectTestDatabase);
  afterEach(clearTestDatabase);
  afterAll(closeTestDatabase);

  it('returns speakable text for the tool response', async () => {
    const user = await createUserFixture();
    await Memory.create({
      user: user.id,
      type: 'story',
      status: 'save',
      title: 'Lagos trip',
      summary: 'Beach day.',
    });

    const res = await request(createTestApp())
      .post('/ai/voice/memory-search')
      .set('Authorization', `Bearer ${issueLegacyAccessToken(user)}`)
      .send({query: 'Lagos'});

    expect(res.status).toBe(200);
    expect(res.body.data.result).toContain('Lagos trip');
    expect(assertAccess).toHaveBeenCalledWith(user.id, 'voice_mode');
  });

  it('requires voice mode access', async () => {
    vi.mocked(assertAccess).mockImplementationOnce(async () =>
      throwSubscriptionRequired('voice_mode'),
    );
    const user = await createUserFixture();

    const res = await request(createTestApp())
      .post('/ai/voice/memory-search')
      .set('Authorization', `Bearer ${issueLegacyAccessToken(user)}`)
      .send({query: 'Lagos'});

    expect(res.status).toBe(402);
  });

  it.each([
    [{}],
    [{query: '  '}],
    [{query: 'x'.repeat(201)}],
    [{query: 'ok', extra: 1}],
  ])('rejects invalid payload %#', async body => {
    const user = await createUserFixture();

    const res = await request(createTestApp())
      .post('/ai/voice/memory-search')
      .set('Authorization', `Bearer ${issueLegacyAccessToken(user)}`)
      .send(body);

    expect(res.status).toBe(422);
  });
});
