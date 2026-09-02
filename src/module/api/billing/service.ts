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
  cancelPolarSubscription,
  createPolarCheckoutSession,
  createPolarPortalSession,
  listPolarInvoices,
  resolvePolarProductPlan,
  resumePolarSubscription,
} from './providers/polar';
import {getStorageUsageSummary} from './storage-quota';
import mongoose from 'mongoose';

type CheckoutBody = {
  success_url: string;
  cancel_url: string;
  tier?: 'free' | 'pro' | 'legacy';
  interval?: 'monthly' | 'annual' | 'lifetime';
};

export async function getSubscriptionSummary(userId: string) {
  const [subscription, usage, storage] = await Promise.all([
    Subscription.findOne({user_id: userId}).lean(),
    Usage.findOne({user_id: userId}).lean(),
    getStorageUsageSummary(userId),
  ]);

  if (!subscription) {
    return {
      message: 'Subscription summary fetched',
      data: {
        tier: 'free',
        status: 'active',
        usage: {
          storage_used_bytes: storage.used_bytes,
          storage_reserved_bytes: storage.reserved_bytes,
          storage_limit_bytes: storage.limit_bytes,
          remaining_bytes: storage.remaining_bytes,
          percent_used: storage.percent_used,
          over_limit: storage.over_limit,
          beneficiary_count: usage?.beneficiary_count || 0,
          timed_message_count: usage?.timed_message_count || 0,
        },
      },
    };
  }

  return {
    message: 'Subscription summary fetched',
    data: {
      tier: subscription.tier,
      status: subscription.status,
      current_period_end: subscription.current_period_end,
      cancel_at_period_end: subscription.cancel_at_period_end || false,
      trial_ends_at: subscription.trial_ends_at,
      provider: subscription.payment_provider,
      currency: subscription.currency,
      country: subscription.country,
      usage: {
        storage_used_bytes: storage.used_bytes,
        storage_reserved_bytes: storage.reserved_bytes,
        storage_limit_bytes: storage.limit_bytes,
        remaining_bytes: storage.remaining_bytes,
        percent_used: storage.percent_used,
        over_limit: storage.over_limit,
        beneficiary_count: usage?.beneficiary_count || 0,
        timed_message_count: usage?.timed_message_count || 0,
      },
    },
  };
}

export async function getUsage(userId: string) {
  const [usage, storage] = await Promise.all([
    Usage.findOne({user_id: userId}).lean(),
    getStorageUsageSummary(userId),
  ]);
  return {
    message: 'Usage fetched',
    data: {
      user_id: userId,
      beneficiary_count: usage?.beneficiary_count || 0,
      timed_message_count: usage?.timed_message_count || 0,
      time_capsule_count: usage?.time_capsule_count || 0,
      memory_integration_count: usage?.memory_integration_count || 0,
      storage_used_bytes: storage.used_bytes,
      storage_reserved_bytes: storage.reserved_bytes,
      storage_limit_bytes: storage.limit_bytes,
      remaining_bytes: storage.remaining_bytes,
      percent_used: storage.percent_used,
      over_limit: storage.over_limit,
    },
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

export async function listInvoices(userId: string) {
  const invoices = await listPolarInvoices(userId);
  return {
    message: 'Invoices fetched',
    data: invoices,
  };
}

export async function cancelSubscription(userId: string) {
  const subscription = await Subscription.findOne({user_id: userId});
  if (!subscription) throw new NotFoundException('Subscription not found');
  if (subscription.tier === 'free') {
    throw new BadRequestException('Free plan has no cancellation flow');
  }
  if (
    subscription.payment_provider !== 'polar' ||
    !subscription.provider_subscription_id
  ) {
    throw new BadRequestException('Polar subscription is not available');
  }
  const provider = await cancelPolarSubscription(
    subscription.provider_subscription_id,
  );
  subscription.status = mapPolarStatus(
    'subscription.canceled',
    provider.status,
  );
  subscription.cancel_at_period_end = provider.cancel_at_period_end !== false;
  subscription.cancelled_at = provider.canceled_at
    ? new Date(String(provider.canceled_at))
    : new Date();
  await subscription.save();
  return {
    message: 'Subscription cancellation scheduled',
    data: {
      status: subscription.status,
      cancel_at_period_end: subscription.cancel_at_period_end,
      current_period_end: subscription.current_period_end,
    },
  };
}

export async function resumeSubscription(userId: string) {
  const subscription = await Subscription.findOne({user_id: userId});
  if (!subscription) throw new NotFoundException('Subscription not found');
  if (subscription.tier === 'free') {
    throw new BadRequestException('Free plan has no resumable subscription');
  }
  if (
    subscription.payment_provider !== 'polar' ||
    !subscription.provider_subscription_id
  ) {
    throw new BadRequestException('Polar subscription is not available');
  }
  await resumePolarSubscription(subscription.provider_subscription_id);
  subscription.status = 'active';
  subscription.cancel_at_period_end = false;
  subscription.cancelled_at = null;
  await subscription.save();
  return {
    message: 'Subscription resumed',
    data: {status: subscription.status, cancel_at_period_end: false},
  };
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

function mapPolarStatus(
  eventType: string,
  providerStatus?: unknown,
): 'active' | 'trialing' | 'past_due' | 'cancelled' | 'paused' {
  if (providerStatus === 'active') return 'active';
  if (providerStatus === 'trialing') return 'trialing';
  if (providerStatus === 'past_due') return 'past_due';
  if (providerStatus === 'paused') return 'paused';
  if (providerStatus === 'canceled' || providerStatus === 'unpaid') {
    return 'cancelled';
  }
  if (eventType.includes('trial')) return 'trialing';
  if (eventType.includes('paused')) return 'paused';
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

export async function processPolarWebhook(
  payload: Record<string, unknown>,
  deliveryId?: string,
) {
  const eventId =
    (typeof payload.id === 'string' && payload.id) ||
    (typeof payload.event_id === 'string' && payload.event_id) ||
    deliveryId;
  const eventType =
    (typeof payload.type === 'string' && payload.type) ||
    (typeof payload.event_type === 'string' && payload.event_type) ||
    'unknown';

  if (!eventId) {
    throw new BadRequestException('Missing Polar event id');
  }

  const data =
    payload.data && typeof payload.data === 'object'
      ? (payload.data as Record<string, unknown>)
      : {};
  const metadata =
    data.metadata && typeof data.metadata === 'object'
      ? (data.metadata as Record<string, unknown>)
      : {};

  const customer =
    data.customer && typeof data.customer === 'object'
      ? (data.customer as Record<string, unknown>)
      : {};
  const userId =
    (typeof data.external_customer_id === 'string' &&
      data.external_customer_id) ||
    (typeof data.user_id === 'string' && data.user_id) ||
    (typeof metadata.user_id === 'string' && metadata.user_id) ||
    (typeof customer.external_id === 'string' && customer.external_id);

  const normalizedEventType = eventType.toLowerCase();
  const isSubscriptionEvent = normalizedEventType.startsWith('subscription.');
  const plan = isSubscriptionEvent
    ? resolvePolarProductPlan(
        typeof data.product_id === 'string' ? data.product_id : undefined,
        metadata,
      )
    : null;
  const tier = plan?.tier ?? null;
  const status = mapPolarStatus(normalizedEventType, data.status);
  const interval = plan?.interval ?? null;
  const providerModifiedAtValue = data.modified_at ?? payload.timestamp;
  const providerModifiedAt = providerModifiedAtValue
    ? new Date(String(providerModifiedAtValue))
    : null;
  const hasValidProviderModifiedAt =
    providerModifiedAt !== null && !Number.isNaN(providerModifiedAt.getTime());
  const terminal =
    normalizedEventType === 'subscription.revoked' || data.status === 'unpaid';
  const endedAtValue = data.ended_at;
  const parsedEndedAt = endedAtValue ? new Date(String(endedAtValue)) : null;
  const endedAt =
    parsedEndedAt && !Number.isNaN(parsedEndedAt.getTime())
      ? parsedEndedAt
      : terminal
        ? hasValidProviderModifiedAt
          ? providerModifiedAt
          : new Date()
        : null;
  const session = await mongoose.startSession();
  let duplicate = false;
  try {
    await session.withTransaction(async () => {
      const existing = await BillingWebhookEvent.exists({
        provider: 'polar',
        event_id: eventId,
      }).session(session);
      if (existing) {
        duplicate = true;
        return;
      }
      await BillingWebhookEvent.create(
        [
          {
            provider: 'polar',
            event_id: eventId,
            event_type: eventType,
            user_id: userId || null,
            provider_customer_id:
              (typeof data.customer_id === 'string' && data.customer_id) ||
              null,
          },
        ],
        {session},
      );
      if (!userId || !isSubscriptionEvent) return;
      const currentSubscription = await Subscription.findOne({
        user_id: userId,
      })
        .session(session)
        .lean();
      if (
        hasValidProviderModifiedAt &&
        currentSubscription?.provider_modified_at &&
        currentSubscription.provider_modified_at > providerModifiedAt
      ) {
        return;
      }
      await Subscription.findOneAndUpdate(
        {user_id: userId},
        {
          $setOnInsert: {user_id: userId, has_used_trial: false},
          $set: {
            payment_provider: 'polar',
            ...(tier ? {tier} : {}),
            ...(interval ? {billing_interval: interval} : {}),
            status,
            cancel_at_period_end: data.cancel_at_period_end === true,
            ended_at: endedAt,
            ...(hasValidProviderModifiedAt && {
              provider_modified_at: providerModifiedAt,
            }),
            cancelled_at: data.canceled_at
              ? new Date(String(data.canceled_at))
              : null,
            current_period_start: data.current_period_start
              ? new Date(String(data.current_period_start))
              : null,
            current_period_end: data.current_period_end
              ? new Date(String(data.current_period_end))
              : null,
            trial_ends_at: data.trial_end
              ? new Date(String(data.trial_end))
              : null,
            provider_customer_id:
              (typeof data.customer_id === 'string' && data.customer_id) ||
              null,
            provider_subscription_id:
              (typeof data.id === 'string' && data.id) ||
              (typeof data.subscription_id === 'string' &&
                data.subscription_id) ||
              null,
          },
        },
        {upsert: true, new: true, session},
      );
    });
  } catch (error) {
    if ((error as {code?: number})?.code === 11000) duplicate = true;
    else throw error;
  } finally {
    await session.endSession();
  }

  if (duplicate) {
    return {message: 'Duplicate webhook ignored', data: {duplicate: true}};
  }

  if (!userId) {
    return {
      message: 'Webhook recorded without user mapping',
      data: {eventId, eventType},
    };
  }

  if (!isSubscriptionEvent) {
    return {
      message: 'Polar event recorded without subscription mutation',
      data: {eventId, eventType, ignored: true},
    };
  }

  return {message: 'Polar webhook processed', data: {eventId, eventType}};
}
