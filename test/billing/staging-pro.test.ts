import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';

vi.mock('../../src/utils/config', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/utils/config')>()),
  STAGING_AUTO_PRO: true,
}));

import Subscription from '../../src/module/database/model/subscription';
import Usage from '../../src/module/database/model/usage';
import {checkFeatureAccess} from '../../src/module/api/billing/access';
import {getSubscriptionSummary} from '../../src/module/api/billing/service';
import {reserveStorage} from '../../src/module/api/billing/storage-quota';
import {acquireUsageSlot} from '../../src/module/api/billing/usage-accounting';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestReplicaSet,
} from '../helpers/database';
import {createUserFixture} from '../helpers/factories';

describe('staging Pro entitlement', () => {
  beforeAll(connectTestReplicaSet);
  afterEach(clearTestDatabase);
  afterAll(closeTestDatabase);

  it('gives a new account Pro access before any billing record exists', async () => {
    const user = await createUserFixture();
    expect(await checkFeatureAccess(user.id, 'voice_mode')).toEqual({
      allowed: true,
    });
    const summary = await getSubscriptionSummary(user.id);
    expect(summary.data).toMatchObject({
      tier: 'pro',
      status: 'active',
      usage: {storage_limit_bytes: 10 * 1024 ** 3},
    });
  });

  it.each(['free', 'expired', 'legacy'])(
    'gives an existing %s account Pro without rewriting billing history',
    async kind => {
      const user = await createUserFixture();
      const expired = new Date('2020-01-01');
      await Subscription.create({
        user_id: user.id,
        tier: kind === 'expired' ? 'pro' : kind,
        status: 'cancelled',
        current_period_end: expired,
        ended_at: expired,
        trial_ends_at: expired,
        cancel_at_period_end: true,
        payment_provider: 'polar',
        provider_subscription_id: 'existing-subscription',
      });
      const before = await Subscription.findOne({user_id: user.id}).lean();
      const summary = await getSubscriptionSummary(user.id);
      expect(summary.data).toMatchObject({
        tier: 'pro',
        status: 'active',
        current_period_end: null,
        trial_ends_at: null,
        cancel_at_period_end: false,
        usage: {storage_limit_bytes: 10 * 1024 ** 3},
      });
      expect(await checkFeatureAccess(user.id, 'supermemory')).toEqual({
        allowed: true,
      });
      expect(await Subscription.findOne({user_id: user.id}).lean()).toEqual(
        before,
      );
    },
  );

  it('uses Pro limits for uploads and counted features on existing free accounts', async () => {
    const user = await createUserFixture();
    await Subscription.create({user_id: user.id, tier: 'free'});
    await Usage.create({user_id: user.id, beneficiary_count: 2});

    const reservation = await reserveStorage(user.id, 300 * 1024 ** 2);
    expect(reservation.limit_bytes).toBe(10 * 1024 ** 3);
    await acquireUsageSlot(user.id, 'beneficiary_count', 2, 'beneficiaries');
    expect(await Usage.findOne({user_id: user.id}).lean()).toMatchObject({
      beneficiary_count: 3,
    });
  });
});
