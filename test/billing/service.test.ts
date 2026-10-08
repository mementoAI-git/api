import {beforeAll, afterAll, afterEach, vi} from 'vitest';
import {
  connectTestReplicaSet,
  clearTestDatabase,
  closeTestDatabase,
} from '../helpers/database';
import {createUserFixture} from '../helpers/factories';
vi.mock('../../src/utils/config', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/utils/config')>()),
  POLAR_PRODUCT_PRO_MONTHLY: undefined,
  POLAR_PRODUCT_PRO_ANNUAL: undefined,
  POLAR_PRODUCT_LEGACY_MONTHLY: undefined,
  POLAR_PRODUCT_LEGACY_ANNUAL: undefined,
  POLAR_PRODUCT_LEGACY_LIFETIME: undefined,
}));
beforeAll(connectTestReplicaSet);
afterEach(clearTestDatabase);
afterAll(closeTestDatabase);
vi.mock('../../src/module/api/billing/storage-quota', async importOriginal => ({
  ...(await importOriginal<
    typeof import('../../src/module/api/billing/storage-quota')
  >()),
  getStorageUsageSummary: vi.fn(async () => ({
    used_bytes: 0,
    reserved_bytes: 0,
    limit_bytes: 1000,
    remaining_bytes: 1000,
    percent_used: 0,
    over_limit: false,
  })),
}));
import assert from 'node:assert/strict';
import {test, mock} from '../helpers/legacy-test';
import Subscription from '../../src/module/database/model/subscription';
import User from '../../src/module/database/model/user';
import BillingWebhookEvent from '../../src/module/database/model/billing-webhook-event';
import {
  getBillingAccount,
  processPolarWebhook,
} from '../../src/module/api/billing/service';

void test('accounts without checkout return account identity and no invented payment methods', async () => {
  const user = mock.method(User, 'findById', () => ({
    lean: async () => ({
      email: 'user@example.com',
      first_name: 'Test',
      last_name: 'User',
    }),
  }));
  const subscription = mock.method(Subscription, 'findOne', () => ({
    lean: async () => null,
  }));
  try {
    const result = await getBillingAccount('user_1');
    assert.deepEqual(result.data, {
      has_customer: false,
      email: 'user@example.com',
      name: 'Test User',
      address: null,
      payment_methods: [],
    });
  } finally {
    user.mock.restore();
    subscription.mock.restore();
  }
});
void test('real Polar delivery ID and nested customer map subscription state and dates', async () => {
  const user = await createUserFixture();
  await processPolarWebhook(
    {
      type: 'subscription.updated',
      data: {
        id: 'sub_1',
        customer_id: 'cus_1',
        customer: {external_id: user.id},
        metadata: {tier: 'pro', interval: 'monthly'},
        status: 'trialing',
        current_period_end: '2026-11-01T00:00:00Z',
        currency: 'usd',
      },
    },
    'delivery_1',
  );
  const subscription = await Subscription.findOne({user_id: user.id}).lean();
  assert.equal(subscription?.tier, 'pro');
  assert.equal(subscription?.status, 'trialing');
  assert.equal(subscription?.provider_subscription_id, 'sub_1');
  assert.equal(subscription?.currency, 'USD');
  assert.ok(subscription?.current_period_end instanceof Date);
  assert.equal(
    (await BillingWebhookEvent.findOne({event_id: 'delivery_1'}))?.event_id,
    'delivery_1',
  );
});
void test('unrelated customer events cannot reactivate a subscription', async () => {
  const user = await createUserFixture();
  await Subscription.create({
    user_id: user.id,
    tier: 'pro',
    status: 'cancelled',
  });
  await processPolarWebhook(
    {type: 'customer.updated', data: {customer: {external_id: user.id}}},
    'delivery_customer',
  );
  assert.equal(
    (await Subscription.findOne({user_id: user.id}))?.status,
    'cancelled',
  );
});
void test('duplicate deliveries do not change a subscription twice', async () => {
  await BillingWebhookEvent.create({
    provider: 'polar',
    event_id: 'delivery_1',
    event_type: 'subscription.active',
  });
  const result = await processPolarWebhook(
    {type: 'subscription.active'},
    'delivery_1',
  );
  assert.equal(result.data.duplicate, true);
  assert.equal(await Subscription.countDocuments(), 0);
});

void test('cancellation updates Polar before saving, retains access, and is owner scoped', async () => {
  const provider = await import('../../src/module/api/billing/providers/polar');
  const service = await import('../../src/module/api/billing/service');
  const events: string[] = [];
  const sub = {
    tier: 'pro',
    status: 'active',
    billing_interval: 'monthly',
    payment_provider: 'polar',
    provider_subscription_id: 'sub_1',
    cancel_at_period_end: false,
    cancelled_at: null as Date | null,
    current_period_end: null as Date | null,
    save: async () => {
      events.push('save');
    },
  };
  const lookup = mock.method(
    Subscription,
    'findOne',
    async (query: unknown) => {
      assert.deepEqual(query, {user_id: 'user_1'});
      return sub;
    },
  );
  const patch = mock.method(
    provider,
    'updatePolarCancellation',
    async (id: string, cancel: boolean, feedback: unknown) => {
      assert.equal(id, 'sub_1');
      assert.equal(cancel, true);
      assert.deepEqual(feedback, {reason: 'unused'});
      events.push('provider');
      return {
        cancel_at_period_end: true,
        current_period_end: '2026-11-01T00:00:00Z',
      };
    },
  );
  try {
    await service.cancelSubscription('user_1', {reason: 'unused'});
    assert.deepEqual(events, ['provider', 'save']);
    assert.equal(sub.status, 'active');
    assert.equal(sub.cancel_at_period_end, true);
    assert.ok(sub.current_period_end instanceof Date);
  } finally {
    lookup.mock.restore();
    patch.mock.restore();
  }
});
void test('provider failure never marks cancellation successful locally', async () => {
  const provider = await import('../../src/module/api/billing/providers/polar');
  const service = await import('../../src/module/api/billing/service');
  let saved = false;
  const sub = {
    store_account_token: 'test-token',
    tier: 'pro',
    status: 'active',
    billing_interval: 'annual',
    payment_provider: 'polar',
    provider_subscription_id: 'sub_1',
    cancel_at_period_end: false,
    save: async () => {
      saved = true;
    },
  };
  const lookup = mock.method(Subscription, 'findOne', async () => sub);
  const patch = mock.method(provider, 'updatePolarCancellation', async () => {
    throw new Error('Provider failed');
  });
  try {
    await assert.rejects(
      service.cancelSubscription('user_1'),
      /Provider failed/,
    );
    assert.equal(saved, false);
    assert.equal(sub.cancel_at_period_end, false);
  } finally {
    lookup.mock.restore();
    patch.mock.restore();
  }
});
void test('promo or lifetime access cannot trigger provider cancellation', async () => {
  const service = await import('../../src/module/api/billing/service');
  const lookup = mock.method(Subscription, 'findOne', async () => ({
    tier: 'pro',
    status: 'active',
    provider_subscription_id: null,
  }));
  try {
    await assert.rejects(
      service.cancelSubscription('user_1'),
      /no recurring web subscription/,
    );
  } finally {
    lookup.mock.restore();
  }
});

void test('resume updates Polar and clears the scheduled flag after confirmation', async () => {
  const provider = await import('../../src/module/api/billing/providers/polar');
  const service = await import('../../src/module/api/billing/service');
  const sub = {
    tier: 'pro',
    status: 'active',
    billing_interval: 'monthly',
    payment_provider: 'polar',
    provider_subscription_id: 'sub_1',
    cancel_at_period_end: true,
    cancelled_at: new Date(),
    save: async () => {},
  };
  const lookup = mock.method(Subscription, 'findOne', async () => sub);
  const patch = mock.method(
    provider,
    'updatePolarCancellation',
    async (_id: string, cancel: boolean) => {
      assert.equal(cancel, false);
      return {cancel_at_period_end: false};
    },
  );
  try {
    await service.resumeSubscription('user_1');
    assert.equal(sub.cancel_at_period_end, false);
    assert.equal(sub.cancelled_at, null);
  } finally {
    lookup.mock.restore();
    patch.mock.restore();
  }
});
void test('checkout cannot create a second active subscription', async () => {
  const service = await import('../../src/module/api/billing/service');
  const lookup = mock.method(Subscription, 'findOne', () => ({
    lean: async () => ({status: 'active', provider_subscription_id: 'sub_1'}),
  }));
  const user = mock.method(User, 'findById', () => ({
    lean: async () => ({email: 'test@example.com'}),
  }));
  try {
    await assert.rejects(
      service.createCheckoutSession('user_1', {
        success_url: 'https://web.test/success',
        cancel_url: 'https://web.test/cancel',
      }),
      /existing subscription/,
    );
  } finally {
    lookup.mock.restore();
    user.mock.restore();
  }
});
void test('cancellation input rejects unknown fields, invalid reasons, and oversized feedback', async () => {
  const {cancelSchema} = await import('../../src/module/api/billing/dto');
  assert.equal(
    cancelSchema.safeParse({
      body: {reason: 'unused', comment: 'Taking a break'},
    }).success,
    true,
  );
  for (const body of [
    {user_id: 'another'},
    {reason: 'invalid'},
    {comment: 'a'.repeat(1001)},
  ])
    assert.equal(cancelSchema.safeParse({body}).success, false);
});

void test('summary exposes the actual interval and recurring management capability', async () => {
  const Usage = (await import('../../src/module/database/model/usage')).default;
  const {getSubscriptionSummary} = await import(
    '../../src/module/api/billing/service'
  );
  const sub = {
    store_account_token: 'test-token',
    tier: 'pro',
    status: 'active',
    billing_interval: 'annual',
    payment_provider: 'polar',
    provider_subscription_id: 'sub_1',
    cancel_at_period_end: true,
    current_period_end: new Date('2099-01-01'),
  };
  const lookup = mock.method(Subscription, 'findOne', () => ({
    ...sub,
    lean: async () => sub,
  }));
  const usage = mock.method(Usage, 'findOne', () => ({lean: async () => null}));
  try {
    const result = await getSubscriptionSummary('user_1');
    assert.equal(result.data.billing_interval, 'annual');
    assert.equal(result.data.can_manage_subscription, true);
    assert.equal(result.data.tier, 'pro');
    sub.current_period_end = new Date('2000-01-01');
    const expired = await getSubscriptionSummary('user_1');
    assert.equal(expired.data.tier, 'free');
    assert.equal(expired.data.can_manage_subscription, false);
    const {checkFeatureAccess} = await import(
      '../../src/module/api/billing/access'
    );
    assert.equal(
      (await checkFeatureAccess('user_1', 'voice_mode')).allowed,
      false,
    );
    sub.current_period_end = new Date('2099-01-01');
    assert.equal(
      (await checkFeatureAccess('user_1', 'voice_mode')).allowed,
      true,
    );
  } finally {
    lookup.mock.restore();
    usage.mock.restore();
  }
});

void test('older subscriptions resolve their interval from Polar rather than guessing monthly', async () => {
  const Usage = (await import('../../src/module/database/model/usage')).default;
  const provider = await import('../../src/module/api/billing/providers/polar');
  const {getSubscriptionSummary} = await import(
    '../../src/module/api/billing/service'
  );
  const lookup = mock.method(Subscription, 'findOne', () => ({
    store_account_token: 'test-token',
    tier: 'pro',
    status: 'active',
    billing_interval: null,
    payment_provider: 'polar',
    provider_subscription_id: 'sub_1',
    lean: async () => null,
  }));
  const usage = mock.method(Usage, 'findOne', () => ({lean: async () => null}));
  const interval = mock.method(
    provider,
    'getPolarSubscriptionInterval',
    async (id: string) => {
      assert.equal(id, 'sub_1');
      return 'annual' as const;
    },
  );
  const update = mock.method(
    Subscription,
    'updateOne',
    async (query: unknown, change: unknown) => {
      assert.deepEqual(query, {
        user_id: 'user_1',
        provider_subscription_id: 'sub_1',
        billing_interval: null,
      });
      assert.deepEqual(change, {$set: {billing_interval: 'annual'}});
    },
  );
  try {
    const result = await getSubscriptionSummary('user_1');
    assert.equal(result.data.billing_interval, 'annual');
  } finally {
    lookup.mock.restore();
    usage.mock.restore();
    interval.mock.restore();
    update.mock.restore();
  }
});
