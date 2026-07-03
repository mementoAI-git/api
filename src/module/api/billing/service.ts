import dayjs from 'dayjs';
import {
  BadRequestException,
  NotFoundException,
} from '../../../utils/service-error';
import Subscription from '../../database/model/subscription';
import Usage from '../../database/model/usage';
import PromoCode from '../../database/model/promo-code';
import User from '../../database/model/user';
import BillingWebhookEvent from '../../database/model/billing-webhook-event';
import {
  type AccessContext,
  checkFeatureAccess,
  throwSubscriptionRequired,
  type FeatureAccessResult,
} from './access';
import {
  createPolarCheckoutSession,
  createPolarPortalSession,
} from './providers/polar';

type CheckoutBody = {
  success_url: string;
  cancel_url: string;
  tier?: 'free' | 'pro' | 'legacy';
  interval?: 'monthly' | 'annual' | 'lifetime';
};

export async function getSubscriptionSummary(userId: string) {
  const [subscription, usage] = await Promise.all([
    Subscription.findOne({user_id: userId}).lean(),
    Usage.findOne({user_id: userId}).lean(),
  ]);

  if (!subscription) {
    return {
      message: 'Subscription summary fetched',
      data: {
        tier: 'free',
        status: 'active',
        usage: usage
          ? {
              storage_used_bytes: usage.storage_used_bytes,
              storage_limit_bytes: usage.storage_limit_bytes,
              beneficiary_count: usage.beneficiary_count,
              timed_message_count: usage.timed_message_count,
            }
          : undefined,
      },
    };
  }

  return {
    message: 'Subscription summary fetched',
    data: {
      tier: subscription.tier,
      status: subscription.status,
      current_period_end: subscription.current_period_end,
      trial_ends_at: subscription.trial_ends_at,
      provider: subscription.payment_provider,
      currency: subscription.currency,
      country: subscription.country,
      usage: usage
        ? {
            storage_used_bytes: usage.storage_used_bytes,
            storage_limit_bytes: usage.storage_limit_bytes,
            beneficiary_count: usage.beneficiary_count,
            timed_message_count: usage.timed_message_count,
          }
        : undefined,
    },
  };
}

export async function getUsage(userId: string) {
  const usage = await Usage.findOne({user_id: userId}).lean();
  return {
    message: 'Usage fetched',
    data:
      usage ??
      ({
        user_id: userId,
        storage_used_bytes: 0,
        storage_limit_bytes: 5 * 1024 ** 3,
        beneficiary_count: 0,
        timed_message_count: 0,
        time_capsule_count: 0,
        memory_integration_count: 0,
      } as const),
  };
}

export async function createCheckoutSession(
  userId: string,
  body: CheckoutBody,
) {
  if (!body.success_url || !body.cancel_url) {
    throw new BadRequestException('success_url and cancel_url are required');
  }

  const user = await User.findById(userId, {email: 1}).lean();
  if (!user?.email) {
    throw new NotFoundException('User email is required for checkout');
  }
  const tier = body.tier || 'pro';
  const interval = body.interval || 'monthly';

  const polar = await createPolarCheckoutSession({
    userId,
    email: user.email,
    tier,
    interval,
    successUrl: body.success_url,
  });
  const checkout_url = polar.checkoutUrl;

  await Subscription.findOneAndUpdate(
    {user_id: userId},
    {
      $setOnInsert: {
        user_id: userId,
        has_used_trial: false,
      },
      $set: {
        payment_provider: 'polar',
      },
    },
    {upsert: true, new: true},
  );

  return {
    message: 'Checkout session created',
    data: {checkout_url},
  };
}

export async function createPortalSession(userId: string, returnUrl: string) {
  const subscription = await Subscription.findOne({user_id: userId}).lean();
  if (
    !subscription ||
    (subscription.tier !== 'pro' && subscription.tier !== 'legacy')
  ) {
    throw new BadRequestException('No active paid subscription to manage');
  }

  const polar = await createPolarPortalSession({
    externalCustomerId: userId,
    returnUrl,
  });
  const portal_url = polar.portalUrl;
  return {
    message: 'Portal session created',
    data: {portal_url},
  };
}

export async function redeemPromoCode(userId: string, code: string) {
  const normalized = code.trim().toUpperCase();
  const promo = await PromoCode.findOne({code: normalized});
  if (!promo) throw new NotFoundException('Promo code not found');
  if (promo.redeemed_by)
    throw new BadRequestException('Promo code already redeemed');
  if (dayjs(promo.expires_at).isBefore(dayjs())) {
    throw new BadRequestException('Promo code has expired');
  }

  promo.redeemed_by = userId;
  promo.redeemed_at = new Date();
  await promo.save();

  const promoExpiresAt = dayjs().add(promo.duration_days, 'day').toDate();
  await Subscription.findOneAndUpdate(
    {user_id: userId},
    {
      $set: {
        tier: promo.grants_tier,
        status: 'active',
        promo_code_used: promo.code,
        promo_expires_at: promoExpiresAt,
      },
      $setOnInsert: {
        user_id: userId,
        has_used_trial: false,
      },
    },
    {upsert: true, new: true},
  );

  return {
    message: 'Promo applied',
    data: {
      code: promo.code,
      grants_tier: promo.grants_tier,
      expires_at: promoExpiresAt,
    },
  };
}

export async function listInvoices(_userId: string) {
  return {
    message: 'Invoices fetched',
    data: [],
  };
}

export async function cancelSubscription(userId: string) {
  const subscription = await Subscription.findOne({user_id: userId});
  if (!subscription) throw new NotFoundException('Subscription not found');
  if (subscription.tier === 'free') {
    throw new BadRequestException('Free plan has no cancellation flow');
  }
  subscription.status = 'cancelled';
  subscription.cancelled_at = new Date();
  await subscription.save();
  return {message: 'Subscription cancellation scheduled', data: null};
}

export async function resumeSubscription(userId: string) {
  const subscription = await Subscription.findOne({user_id: userId});
  if (!subscription) throw new NotFoundException('Subscription not found');
  if (subscription.tier === 'free') {
    throw new BadRequestException('Free plan has no resumable subscription');
  }
  subscription.status = 'active';
  subscription.cancelled_at = null;
  await subscription.save();
  return {message: 'Subscription resumed', data: null};
}

export async function ensureBillingUser(userId: string) {
  const user = await User.findById(userId, {_id: 1}).lean();
  if (!user) throw new NotFoundException('User not found');
}

export async function checkAccess(
  userId: string,
  feature: string,
  context: AccessContext = {},
): Promise<FeatureAccessResult> {
  return checkFeatureAccess(userId, feature, context);
}

export async function assertAccess(
  userId: string,
  feature: string,
  context: AccessContext = {},
) {
  const access = await checkFeatureAccess(userId, feature, context);
  if (!access.allowed) {
    throwSubscriptionRequired(feature, access.requiredTier || 'pro');
  }
}

function extractPolarTier(
  payload: Record<string, unknown>,
): 'pro' | 'legacy' | null {
  const direct =
    typeof payload.tier === 'string'
      ? payload.tier
      : typeof payload['product_tier'] === 'string'
        ? String(payload['product_tier'])
        : null;
  if (direct === 'pro' || direct === 'legacy') return direct;
  return null;
}

function mapPolarStatus(
  eventType: string,
): 'active' | 'trialing' | 'past_due' | 'cancelled' {
  if (eventType.includes('trial')) return 'trialing';
  if (eventType.includes('past_due') || eventType.includes('payment_failed')) {
    return 'past_due';
  }
  if (
    eventType.includes('canceled') ||
    eventType.includes('cancelled') ||
    eventType.includes('revoked')
  ) {
    return 'cancelled';
  }
  return 'active';
}

export async function processPolarWebhook(payload: Record<string, unknown>) {
  const eventId =
    (typeof payload.id === 'string' && payload.id) ||
    (typeof payload.event_id === 'string' && payload.event_id);
  const eventType =
    (typeof payload.type === 'string' && payload.type) ||
    (typeof payload.event_type === 'string' && payload.event_type) ||
    'unknown';

  if (!eventId) {
    throw new BadRequestException('Missing Polar event id');
  }

  const alreadyProcessed = await BillingWebhookEvent.findOne({
    provider: 'polar',
    event_id: eventId,
  }).lean();
  if (alreadyProcessed) {
    return {message: 'Duplicate webhook ignored', data: {duplicate: true}};
  }

  const data =
    payload.data && typeof payload.data === 'object'
      ? (payload.data as Record<string, unknown>)
      : {};
  const metadata =
    data.metadata && typeof data.metadata === 'object'
      ? (data.metadata as Record<string, unknown>)
      : {};

  const userId =
    (typeof data.external_customer_id === 'string' &&
      data.external_customer_id) ||
    (typeof data.user_id === 'string' && data.user_id) ||
    (typeof metadata.user_id === 'string' && metadata.user_id);

  if (!userId) {
    await BillingWebhookEvent.create({
      provider: 'polar',
      event_id: eventId,
      event_type: eventType,
    });
    return {
      message: 'Webhook recorded without user mapping',
      data: {eventId, eventType},
    };
  }

  const tier = extractPolarTier({
    ...data,
    ...metadata,
  });
  const status = mapPolarStatus(eventType.toLowerCase());

  await Subscription.findOneAndUpdate(
    {user_id: userId},
    {
      $setOnInsert: {user_id: userId, has_used_trial: false},
      $set: {
        payment_provider: 'polar',
        ...(tier ? {tier} : {}),
        status,
        provider_customer_id:
          (typeof data.customer_id === 'string' && data.customer_id) || null,
        provider_subscription_id:
          (typeof data.subscription_id === 'string' && data.subscription_id) ||
          null,
      },
    },
    {upsert: true, new: true},
  );

  await BillingWebhookEvent.create({
    provider: 'polar',
    event_id: eventId,
    event_type: eventType,
  });

  return {message: 'Polar webhook processed', data: {eventId, eventType}};
}
