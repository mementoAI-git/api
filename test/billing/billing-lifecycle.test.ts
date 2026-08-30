import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';

const polar = vi.hoisted(() => ({
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
import {createUserFixture} from '../helpers/factories';

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
    expect(polar.cancelPolarSubscription).toHaveBeenCalledWith(
      'polar-subscription',
    );
    expect(await Subscription.findOne({user_id: user.id}).lean()).toMatchObject(
      {
        status: 'active',
        cancel_at_period_end: true,
      },
    );

    await resumeSubscription(user.id);
    expect(polar.resumePolarSubscription).toHaveBeenCalledWith(
      'polar-subscription',
    );
    expect(await Subscription.findOne({user_id: user.id}).lean()).toMatchObject(
      {
        status: 'active',
        cancel_at_period_end: false,
        cancelled_at: null,
      },
    );
  });

  it('returns Polar order receipts for the authenticated customer only', async () => {
    const user = await createUserFixture();

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
