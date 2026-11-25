import request from 'supertest';
import {createTestApp} from '../helpers/app';
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';

const polar = vi.hoisted(() => ({
  getPolarCustomer: vi.fn(async () => ({id: 'customer-id'})),
  updatePolarCancellation: vi.fn(async (_id: string, cancel: boolean) => ({
    status: 'active',
    cancel_at_period_end: cancel,
  })),
  cancelPolarSubscription: vi.fn(async () => ({
    id: 'polar-subscription',
    status: 'active',
    cancel_at_period_end: true,
    canceled_at: '2026-08-30T00:00:00.000Z',
  })),
  createPolarCheckoutSession: vi.fn(),
  createPolarPortalSession: vi.fn(),
  listPolarInvoices: vi.fn(async () => [
    {id: 'order-id', label: 'INV-1', url: 'https://polar.test/invoice'},
  ]),
  resumePolarSubscription: vi.fn(async () => ({
    id: 'polar-subscription',
    status: 'active',
    cancel_at_period_end: false,
    canceled_at: null,
  })),
  resolvePolarProductPlan: vi.fn(
    (_productId: string, metadata: Record<string, unknown>) => ({
      tier: metadata.tier,
      interval: metadata.interval,
    }),
  ),
}));

vi.mock('../../src/module/api/billing/providers/polar', () => polar);

import {
  cancelSubscription,
  createCheckoutSession,
  getSubscriptionSummary,
  listInvoices,
  processPolarWebhook,
  resumeSubscription,
} from '../../src/module/api/billing/service';
import BillingWebhookEvent from '../../src/module/database/model/billing-webhook-event';
import Subscription from '../../src/module/database/model/subscription';
import {resolveEffectiveTier} from '../../src/module/api/billing/access';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestReplicaSet,
} from '../helpers/database';
import {createUserFixture, issueLegacyAccessToken} from '../helpers/factories';

describe('Polar billing lifecycle', () => {
  beforeAll(connectTestReplicaSet);
  afterEach(async () => {
    vi.clearAllMocks();
    await clearTestDatabase();
  });
  afterAll(closeTestDatabase);

  it('persists cancellation state only after Polar accepts cancel and resume', async () => {
    const user = await createUserFixture();
    await Subscription.create({
      user_id: user.id,
      tier: 'pro',
      status: 'active',
      payment_provider: 'polar',
      provider_subscription_id: 'polar-subscription',
      current_period_end: new Date('2026-09-30T00:00:00.000Z'),
    });

    await cancelSubscription(user.id);
    expect(polar.updatePolarCancellation).toHaveBeenCalledWith(
      'polar-subscription',
      true,
      {},
    );
    expect(await Subscription.findOne({user_id: user.id}).lean()).toMatchObject(
      {
        status: 'active',
        cancel_at_period_end: true,
      },
    );

    await resumeSubscription(user.id);
    expect(polar.updatePolarCancellation).toHaveBeenCalledWith(
      'polar-subscription',
      false,
      {},
    );
    expect(await Subscription.findOne({user_id: user.id}).lean()).toMatchObject(
      {
        status: 'active',
        cancel_at_period_end: false,
        cancelled_at: null,
      },
    );
  });

  it.each(['ios', 'android', 'legacy'])(
    'accepts existing %s cancellation feedback',
    async client => {
      const user = await createUserFixture();
      await Subscription.create({
        user_id: user.id,
        tier: 'pro',
        status: 'active',
        payment_provider: 'polar',
        provider_subscription_id: 'polar-subscription',
      });
      let call = request(createTestApp())
        .post('/billing/cancel')
        .set('Authorization', `Bearer ${issueLegacyAccessToken(user)}`);
      if (client !== 'legacy') call = call.set('X-Memento-Client', client);
      const response = await call.send({
        reason: 'Taking a break from the app',
        details: 'I will return later',
      });
      expect(response.status).toBe(200);
      expect(
        (await Subscription.findOne({user_id: user.id}))?.cancellation_reason,
      ).toBe('Taking a break from the app');
    },
  );

  it('retains the web cancellation comment', async () => {
    const user = await createUserFixture();
    await Subscription.create({
      user_id: user.id,
      tier: 'pro',
      status: 'active',
      payment_provider: 'polar',
      provider_subscription_id: 'polar-subscription',
    });
    const response = await request(createTestApp())
      .post('/billing/cancel')
      .set('Authorization', `Bearer ${issueLegacyAccessToken(user)}`)
      .set('X-Memento-Client', 'web')
      .send({reason: 'unused', comment: 'Taking a break'});
    expect(response.status).toBe(200);
    expect(
      (await Subscription.findOne({user_id: user.id}))?.cancellation_details,
    ).toBe('Taking a break');
  });

  it('returns Polar order receipts for the authenticated customer only', async () => {
    const user = await createUserFixture();

    await Subscription.create({
      user_id: user.id,
      tier: 'pro',
      payment_provider: 'polar',
    });
    const result = await listInvoices(user.id);

    expect(polar.listPolarInvoices).toHaveBeenCalledWith(user.id);
    expect(result.data).toEqual([
      {id: 'order-id', label: 'INV-1', url: 'https://polar.test/invoice'},
    ]);
  });

  it('applies an official subscription event once under concurrent replay', async () => {
    const user = await createUserFixture();
    const event = {
      type: 'subscription.canceled',
      data: {
        id: 'polar-subscription',
        status: 'active',
        cancel_at_period_end: true,
        canceled_at: '2026-08-30T00:00:00.000Z',
        current_period_start: '2026-08-01T00:00:00.000Z',
        current_period_end: '2026-09-01T00:00:00.000Z',
        customer_id: 'polar-customer',
        product_id: 'polar-product',
        metadata: {user_id: user.id, tier: 'pro', interval: 'monthly'},
      },
    };

    const results = await Promise.allSettled([
      processPolarWebhook(event, 'polar-event-id'),
      processPolarWebhook(event, 'polar-event-id'),
    ]);

    expect(results.every(result => result.status === 'fulfilled')).toBe(true);
    expect(
      await BillingWebhookEvent.countDocuments({event_id: 'polar-event-id'}),
    ).toBe(1);
    expect(await Subscription.findOne({user_id: user.id}).lean()).toMatchObject(
      {
        tier: 'pro',
        status: 'active',
        billing_interval: 'monthly',
        provider_customer_id: 'polar-customer',
        provider_subscription_id: 'polar-subscription',
        cancel_at_period_end: true,
        current_period_start: new Date('2026-08-01T00:00:00.000Z'),
        current_period_end: new Date('2026-09-01T00:00:00.000Z'),
      },
    );
  });

  it('does not unlock Pro while the first payment has not gone through', async () => {
    const user = await createUserFixture();
    const event = (status: string, id: string, at: string) => ({
      type: 'subscription.updated',
      timestamp: at,
      data: {
        id: 'polar-incomplete',
        status,
        modified_at: at,
        customer_id: 'polar-customer',
        product_id: 'polar-product',
        metadata: {user_id: user.id, tier: 'pro', interval: 'monthly'},
      },
    });

    await processPolarWebhook(
      event('incomplete', 'evt-incomplete', '2026-11-01T10:00:00.000Z'),
      'evt-incomplete',
    );
    const unpaid = await Subscription.findOne({user_id: user.id}).lean();
    expect(resolveEffectiveTier(unpaid)).toBe('free');

    // Paying later makes the same subscription active.
    await processPolarWebhook(
      event('active', 'evt-active', '2026-11-01T10:05:00.000Z'),
      'evt-active',
    );
    const paid = await Subscription.findOne({user_id: user.id}).lean();
    expect(resolveEffectiveTier(paid)).toBe('pro');
  });

  it('ends the plan when Polar gives up on the first payment', async () => {
    const user = await createUserFixture();
    await processPolarWebhook(
      {
        type: 'subscription.updated',
        data: {
          id: 'polar-expired',
          status: 'incomplete_expired',
          customer_id: 'polar-customer',
          product_id: 'polar-product',
          metadata: {user_id: user.id, tier: 'pro', interval: 'monthly'},
        },
      },
      'evt-incomplete-expired',
    );
    const saved = await Subscription.findOne({user_id: user.id}).lean();
    expect(saved?.status).toBe('cancelled');
    expect(resolveEffectiveTier(saved)).toBe('free');
  });

  it('records non-subscription events without mutating subscription state', async () => {
    const user = await createUserFixture();
    await Subscription.create({
      user_id: user.id,
      tier: 'pro',
      status: 'active',
      payment_provider: 'polar',
      provider_subscription_id: 'polar-subscription',
    });

    const result = await processPolarWebhook(
      {
        type: 'order.paid',
        data: {
          id: 'polar-order',
          external_customer_id: user.id,
          status: 'paid',
        },
      },
      'polar-order-event',
    );

    expect(result.data).toMatchObject({ignored: true});
    expect(polar.resolvePolarProductPlan).not.toHaveBeenCalled();
    expect(await Subscription.findOne({user_id: user.id}).lean()).toMatchObject(
      {
        status: 'active',
        provider_subscription_id: 'polar-subscription',
      },
    );
    expect(
      await BillingWebhookEvent.countDocuments({event_id: 'polar-order-event'}),
    ).toBe(1);
  });

  it('keeps terminal revocation authoritative over delayed older events', async () => {
    const user = await createUserFixture();
    const newer = new Date().toISOString();
    const older = new Date(Date.now() - 60_000).toISOString();
    const common = {
      id: 'polar-subscription',
      customer_id: 'polar-customer',
      product_id: 'polar-product',
      metadata: {user_id: user.id, tier: 'pro', interval: 'monthly'},
    };

    await processPolarWebhook(
      {
        type: 'subscription.revoked',
        data: {
          ...common,
          status: 'canceled',
          modified_at: newer,
          ended_at: new Date(Date.now() - 1_000).toISOString(),
        },
      },
      'revoked-event',
    );
    await processPolarWebhook(
      {
        type: 'subscription.active',
        data: {...common, status: 'active', modified_at: older},
      },
      'delayed-active-event',
    );

    const subscription = await Subscription.findOne({user_id: user.id}).lean();
    expect(subscription).toMatchObject({
      status: 'cancelled',
      provider_modified_at: new Date(newer),
    });
    expect(resolveEffectiveTier(subscription)).toBe('free');
    expect(await BillingWebhookEvent.countDocuments()).toBe(2);
  });
});

describe('one trial per member', () => {
  beforeAll(connectTestReplicaSet);
  afterEach(clearTestDatabase);
  afterAll(closeTestDatabase);

  const startCheckout = async (userId: string) => {
    polar.createPolarCheckoutSession.mockResolvedValue({
      checkoutUrl: 'https://polar.test/checkout',
    });
    await createCheckoutSession(userId, {
      success_url: 'https://web.test/success',
      cancel_url: 'https://web.test/cancel',
    });
    return polar.createPolarCheckoutSession.mock.calls.at(-1)?.[0];
  };

  it('offers the trial to a new member, even after an abandoned checkout', async () => {
    const user = await createUserFixture();
    expect(await startCheckout(user.id)).toMatchObject({allowTrial: true});
    expect(await startCheckout(user.id)).toMatchObject({allowTrial: true});
    expect((await getSubscriptionSummary(user.id)).data).toMatchObject({
      has_used_trial: false,
    });
  });

  it('keeps the trial for a member who has only redeemed a promo', async () => {
    const user = await createUserFixture();
    await Subscription.create({
      user_id: user.id,
      tier: 'pro',
      status: 'active',
      promo_code_used: 'BETA',
    });
    expect(await startCheckout(user.id)).toMatchObject({allowTrial: true});
  });

  it.each([
    ['the recorded flag', {has_used_trial: true, status: 'active'}],
    ['a past trial', {trial_ends_at: new Date('2020-01-01'), status: 'active'}],
    [
      'a past billing period',
      {current_period_end: new Date('2020-01-01'), status: 'active'},
    ],
    ['a past interval', {billing_interval: 'annual', status: 'active'}],
    ['a cancelled status', {status: 'cancelled'}],
  ])(
    'withholds the trial from a returning member with %s',
    async (_, history) => {
      const user = await createUserFixture();
      await Subscription.create({user_id: user.id, tier: 'free', ...history});
      expect(await startCheckout(user.id)).toMatchObject({allowTrial: false});
      expect((await getSubscriptionSummary(user.id)).data).toMatchObject({
        has_used_trial: true,
      });
    },
  );

  // A tester's App Store sandbox plan ended on Oct 27 but still read
  // "active"; the web checkout told them to manage their existing plan.
  it('lets a member whose App Store plan lapsed start a web checkout', async () => {
    const user = await createUserFixture();
    await Subscription.create({
      user_id: user.id,
      tier: 'pro',
      status: 'active',
      payment_provider: 'apple',
      provider_subscription_id: 'old_apple_tx',
      current_period_end: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    });
    expect(await startCheckout(user.id)).toMatchObject({allowTrial: false});
  });

  it('still sends a member with a live App Store plan to Manage plan', async () => {
    const user = await createUserFixture();
    await Subscription.create({
      user_id: user.id,
      tier: 'pro',
      status: 'active',
      payment_provider: 'apple',
      provider_subscription_id: 'live_apple_tx',
      current_period_end: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
    });
    await expect(startCheckout(user.id)).rejects.toThrow(/Use Manage plan/);
  });

  it('records the trial from a subscription webhook and keeps it after cancellation', async () => {
    const user = await createUserFixture();
    polar.resolvePolarProductPlan.mockReturnValue({
      tier: 'pro',
      interval: 'monthly',
    });
    const event = (status: string, trial_end: string | null) => ({
      type: 'subscription.updated',
      data: {
        id: 'polar-sub',
        external_customer_id: user.id,
        status,
        trial_end,
      },
    });
    await processPolarWebhook(
      event('trialing', '2026-02-01T00:00:00Z'),
      'trial-start',
    );
    expect(await Subscription.findOne({user_id: user.id}).lean()).toMatchObject(
      {
        has_used_trial: true,
      },
    );
    await processPolarWebhook(event('canceled', null), 'trial-cancel');
    expect(await Subscription.findOne({user_id: user.id}).lean()).toMatchObject(
      {
        has_used_trial: true,
      },
    );
    expect(await startCheckout(user.id)).toMatchObject({allowTrial: false});
  });
});
