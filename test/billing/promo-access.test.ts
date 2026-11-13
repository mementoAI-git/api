import dayjs from 'dayjs';
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import {resolveEffectiveTier} from '../../src/module/api/billing/access';
import {redeemPromoCode} from '../../src/module/api/billing/service';
import PromoCode from '../../src/module/database/model/promo-code';
import Subscription, {
  type ISubscription,
} from '../../src/module/database/model/subscription';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';
import {createUserFixture} from '../helpers/factories';

const past = () => dayjs().subtract(1, 'day').toDate();
const future = () => dayjs().add(30, 'day').toDate();
const sub = (fields: Partial<ISubscription>) =>
  ({tier: 'pro', status: 'active', ...fields}) as ISubscription;

describe('promo access', () => {
  it('ends a promo-only plan when the promo expires', () => {
    expect(resolveEffectiveTier(sub({promo_expires_at: future()}))).toBe('pro');
    expect(resolveEffectiveTier(sub({promo_expires_at: past()}))).toBe('free');
  });

  it('keeps a paid plan after an old promo expires', () => {
    // Redeemed a promo, then subscribed: the expired promo must not take Pro away.
    const paying = sub({
      payment_provider: 'polar',
      provider_subscription_id: 'sub_1',
      current_period_end: future(),
      promo_expires_at: past(),
    });
    expect(resolveEffectiveTier(paying)).toBe('pro');
  });

  it('gives a past subscriber the promo while it lasts, and no longer', () => {
    const lapsed = {
      payment_provider: 'polar' as const,
      provider_subscription_id: 'sub_old',
      status: 'cancelled' as const,
      ended_at: past(),
      current_period_end: past(),
    };
    expect(
      resolveEffectiveTier(sub({...lapsed, promo_expires_at: future()})),
    ).toBe('pro');
    expect(
      resolveEffectiveTier(sub({...lapsed, promo_expires_at: past()})),
    ).toBe('free');
  });

  it('still ends a paid plan that was cancelled and has run out', () => {
    expect(
      resolveEffectiveTier(
        sub({
          payment_provider: 'polar',
          status: 'cancelled',
          cancel_at_period_end: true,
          current_period_end: past(),
          promo_expires_at: past(),
        }),
      ),
    ).toBe('free');
  });
});

describe('store subscriptions', () => {
  const daysAgo = (days: number) => dayjs().subtract(days, 'day').toDate();
  const store = (provider: 'apple' | 'google', periodEnd: Date) =>
    sub({
      payment_provider: provider,
      provider_subscription_id: 'chain-1',
      status: 'active',
      current_period_end: periodEnd,
    });

  it('end Pro a few days after the paid period, even if no store notice arrived', () => {
    // A member who cancels in the store settings may never trigger a notice.
    expect(resolveEffectiveTier(store('apple', daysAgo(4)))).toBe('free');
    expect(resolveEffectiveTier(store('google', daysAgo(4)))).toBe('free');
  });

  it('keep Pro briefly after the period while a renewal is still being reported', () => {
    expect(resolveEffectiveTier(store('apple', daysAgo(1)))).toBe('pro');
    expect(resolveEffectiveTier(store('google', future()))).toBe('pro');
  });

  it('leave Polar plans to Polar, which reports endings itself', () => {
    const polar = sub({
      payment_provider: 'polar',
      provider_subscription_id: 'sub_1',
      status: 'active',
      current_period_end: daysAgo(4),
    });
    expect(resolveEffectiveTier(polar)).toBe('pro');
  });
});

describe('redeeming a promo code', () => {
  beforeAll(connectTestDatabase);
  afterEach(clearTestDatabase);
  afterAll(closeTestDatabase);

  const promo = (code: string) =>
    PromoCode.create({
      code,
      grants_tier: 'pro',
      duration_days: 30,
      created_by: 'staff',
      expires_at: future(),
    });

  it('can be redeemed only once, even by two requests at the same moment', async () => {
    await promo('BETA1');
    const [a, b] = await Promise.all([
      createUserFixture(),
      createUserFixture(),
    ]);

    const results = await Promise.allSettled([
      redeemPromoCode(a.id, 'beta1'),
      redeemPromoCode(b.id, 'beta1'),
    ]);

    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(await Subscription.countDocuments({promo_code_used: 'BETA1'})).toBe(
      1,
    );
  });

  it('is refused while a store or Polar subscription is paying', async () => {
    await promo('BETA2');
    const user = await createUserFixture();
    await Subscription.create({
      user_id: user.id,
      tier: 'legacy',
      status: 'active',
      payment_provider: 'polar',
      provider_subscription_id: 'sub_paid',
      current_period_end: future(),
    });

    await expect(redeemPromoCode(user.id, 'BETA2')).rejects.toMatchObject({
      statusCode: 400,
    });
    const saved = await Subscription.findOne({user_id: user.id}).lean();
    expect(saved?.tier).toBe('legacy');
    expect(
      (await PromoCode.findOne({code: 'BETA2'}).lean())?.redeemed_by,
    ).toBeNull();
  });
});
