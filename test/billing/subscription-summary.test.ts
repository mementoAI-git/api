import dayjs from 'dayjs';
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import {getSubscriptionSummary} from '../../src/module/api/billing/service';
import Subscription, {
  type ISubscription,
} from '../../src/module/database/model/subscription';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestReplicaSet,
} from '../helpers/database';
import {createUserFixture} from '../helpers/factories';

const past = () => dayjs().subtract(1, 'day').toDate();
const future = () => dayjs().add(30, 'day').toDate();

async function summaryTier(fields: Partial<ISubscription>) {
  const user = await createUserFixture();
  await Subscription.create({
    user_id: user.id,
    tier: 'pro',
    status: 'active',
    billing_interval: 'monthly',
    ...fields,
  });
  return (await getSubscriptionSummary(user.id)).data.tier;
}

describe('subscription summary', () => {
  beforeAll(connectTestReplicaSet);
  afterEach(clearTestDatabase);
  afterAll(closeTestDatabase);

  // The apps show this tier; it must match what the feature gates allow.
  it('reports the plan the member can actually use', async () => {
    expect(await summaryTier({current_period_end: future()})).toBe('pro');
    expect(await summaryTier({ended_at: past()})).toBe('free');
    expect(
      await summaryTier({status: 'past_due', current_period_end: past()}),
    ).toBe('free');
    expect(await summaryTier({promo_expires_at: past()})).toBe('free');
    expect(
      await summaryTier({
        cancel_at_period_end: true,
        current_period_end: past(),
      }),
    ).toBe('free');
  });
});
