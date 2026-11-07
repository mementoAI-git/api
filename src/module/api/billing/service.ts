import {
  verifyAppleStoreKit2Jws,
  verifyLegacyAppleReceipt,
  verifyGooglePlayPurchase,
  type VerifiedStorePurchase,
} from './providers/iap-verifier';
import axios from 'axios';
import jsonwebtoken from 'jsonwebtoken';
import type {IapVerifyBody} from './dto';
import dayjs from 'dayjs';
import {
  ServiceError,
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
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
  getPolarCustomer,
  listPolarPaymentMethods,
  listPolarInvoices,
  updatePolarCancellation,
  getPolarSubscriptionInterval,
  resolvePolarProductPlan,
} from './providers/polar';
import {getStorageUsageSummary} from './storage-quota';
import mongoose from 'mongoose';
import {randomUUID} from 'crypto';
import {applyStoreSubscriptionSnapshot} from './store-entitlement-service';
import {STAGING_AUTO_PRO} from '../../../utils/config';
import {hasUsedTrial} from './trial-eligibility';

type CheckoutBody = {
  success_url: string;
  cancel_url: string;
  tier?: 'free' | 'pro' | 'legacy';
  interval?: 'monthly' | 'annual' | 'lifetime';
};

export async function getSubscriptionSummary(userId: string) {
  const [initialSubscription, usage, storage] = await Promise.all([
    Subscription.findOne({user_id: userId}),
    Usage.findOne({user_id: userId}).lean(),
    getStorageUsageSummary(userId),
  ]);

  let subscription = initialSubscription;

  if (!subscription) {
    subscription = await Subscription.findOneAndUpdate(
      {user_id: userId},
      {
        $setOnInsert: {
          user_id: userId,
          has_used_trial: false,
          store_account_token: randomUUID(),
          tier: 'free',
          status: 'active',
        },
      },
      {upsert: true, new: true},
    );
  } else if (!subscription.store_account_token) {
    subscription.store_account_token = randomUUID();
    await subscription.save();
  }

  // Older webhooks did not persist the interval. Resolve it from the existing
  // provider subscription so the UI never guesses which plan is current.
  if (
    !subscription.billing_interval &&
    subscription.payment_provider === 'polar' &&
    subscription.provider_subscription_id &&
    ['active', 'trialing', 'past_due'].includes(subscription.status)
  ) {
    subscription.billing_interval = await getPolarSubscriptionInterval(
      subscription.provider_subscription_id,
    );
    await Subscription.updateOne(
      {
        user_id: userId,
        provider_subscription_id: subscription.provider_subscription_id,
        billing_interval: null,
      },
      {$set: {billing_interval: subscription.billing_interval}},
    );
  }

  const cancellationEnded = Boolean(
    subscription.cancel_at_period_end &&
      subscription.current_period_end &&
      dayjs(subscription.current_period_end).isBefore(dayjs()),
  );
  return {
    message: 'Subscription summary fetched',
    data: {
      tier: STAGING_AUTO_PRO
        ? 'pro'
        : cancellationEnded
          ? 'free'
          : subscription.tier,
      billing_interval: subscription.billing_interval,
      can_manage_subscription:
        subscription.payment_provider === 'polar' &&
        Boolean(subscription.provider_subscription_id) &&
        subscription.billing_interval !== 'lifetime' &&
        !cancellationEnded &&
        ['active', 'trialing', 'past_due'].includes(subscription.status),
      status: STAGING_AUTO_PRO ? 'active' : subscription.status,
      current_period_end: STAGING_AUTO_PRO
        ? null
        : subscription.current_period_end,
      trial_ends_at: STAGING_AUTO_PRO ? null : subscription.trial_ends_at,
      has_used_trial: hasUsedTrial(subscription),
      cancel_at_period_end: STAGING_AUTO_PRO
        ? false
        : subscription.cancel_at_period_end,
      provider: subscription.payment_provider,
      store_account_token: subscription.store_account_token,
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
  const existing = await Subscription.findOne({user_id: userId}).lean();
  if (
    existing?.provider_subscription_id &&
    ['active', 'trialing', 'past_due'].includes(existing.status)
  ) {
    throw new BadRequestException(
      'Use Manage plan to change your existing subscription',
    );
  }
  const tier = body.tier || 'pro';
  const interval = body.interval || 'monthly';

  const polar = await createPolarCheckoutSession({
    userId,
    email: user.email,
    tier,
    interval,
    successUrl: body.success_url,
    allowTrial: !hasUsedTrial(existing),
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

export async function getBillingAccount(userId: string) {
  const user = await User.findById(userId, {
    email: 1,
    first_name: 1,
    last_name: 1,
  }).lean();
  if (!user) throw new NotFoundException('User not found');
  const subscription = await Subscription.findOne({user_id: userId}).lean();
  // Free and promo-only accounts have no provider customer until checkout.
  const customer =
    subscription?.payment_provider === 'polar'
      ? await getPolarCustomer(userId)
      : null;
  const methods = customer ? await listPolarPaymentMethods(userId) : [];
  return {
    message: 'Billing account fetched',
    data: {
      has_customer: Boolean(customer),
      email: customer?.email || user.email,
      name:
        customer?.billing_name ||
        customer?.name ||
        [user.first_name, user.last_name].filter(Boolean).join(' '),
      address: customer?.billing_address || null,
      payment_methods: methods,
    },
  };
}
export async function listInvoices(userId: string) {
  const subscription = await Subscription.findOne({user_id: userId}).lean();
  const customer =
    subscription?.payment_provider === 'polar'
      ? await getPolarCustomer(userId)
      : null;
  return {
    message: 'Invoices fetched',
    data: customer ? await listPolarInvoices(userId) : [],
  };
}

export type CancellationFeedback = {
  reason?: string;
  comment?: string;
  details?: string;
};

async function setCancellation(
  userId: string,
  cancel: boolean,
  feedback: CancellationFeedback = {},
) {
  const subscription = await Subscription.findOne({user_id: userId});
  if (!subscription) throw new NotFoundException('Subscription not found');
  if (
    subscription.tier === 'free' ||
    subscription.payment_provider !== 'polar' ||
    !subscription.provider_subscription_id ||
    subscription.billing_interval === 'lifetime'
  ) {
    throw new BadRequestException(
      'This account has no recurring web subscription to manage',
    );
  }
  if (!['active', 'trialing', 'past_due'].includes(subscription.status)) {
    throw new BadRequestException('This subscription is no longer active');
  }
  const result = await updatePolarCancellation(
    subscription.provider_subscription_id,
    cancel,
    feedback.details
      ? {...feedback, comment: feedback.comment ?? feedback.details}
      : feedback,
  );
  // Persist only after the provider confirms the change. Keep access until period end.
  if (result.status) subscription.status = mapPolarStatus('', result.status);
  subscription.cancel_at_period_end = result.cancel_at_period_end;
  subscription.cancelled_at = cancel ? new Date() : null;
  if (feedback.reason) subscription.cancellation_reason = feedback.reason;
  if (feedback.comment || feedback.details)
    subscription.cancellation_details = feedback.comment || feedback.details;
  if (result.current_period_end)
    subscription.current_period_end = new Date(result.current_period_end);
  await subscription.save();
  return {
    message: cancel
      ? 'Subscription cancellation scheduled'
      : 'Subscription resumed',
    data: {
      status: subscription.status,
      cancel_at_period_end: result.cancel_at_period_end,
      current_period_end: subscription.current_period_end,
    },
  };
}

export async function cancelSubscription(
  userId: string,
  feedback: CancellationFeedback = {},
) {
  return setCancellation(userId, true, feedback);
}

export async function resumeSubscription(userId: string) {
  return setCancellation(userId, false);
}

export async function ensureBillingUser(userId: string) {
  const user = await User.findById(userId, {_id: 1}).lean();
  if (!user) throw new NotFoundException('User not found');
  return Subscription.findOneAndUpdate(
    {user_id: userId},
    {
      $setOnInsert: {
        user_id: userId,
        has_used_trial: false,
        store_account_token: randomUUID(),
      },
    },
    {upsert: true, new: true},
  );
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
    deliveryId ||
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

  // Customer identity is nested in real subscription/order webhook payloads.
  const customer =
    data.customer && typeof data.customer === 'object'
      ? (data.customer as Record<string, unknown>)
      : {};
  const userId =
    (typeof customer.external_id === 'string' && customer.external_id) ||
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
          $setOnInsert: {user_id: userId},
          $set: {
            has_used_trial: true,
            payment_provider: 'polar',
            ...(typeof data.currency === 'string'
              ? {currency: data.currency.toUpperCase()}
              : {}),
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

const ALLOWED_IAP_SKUS: Record<
  string,
  {interval: 'monthly' | 'annual'; platform: 'ios' | 'android'}
> = {
  'io.mymemento.app.pro.monthly': {interval: 'monthly', platform: 'ios'},
  'io.mymemento.app.pro.annual': {interval: 'annual', platform: 'ios'},
  memento_pro_monthly: {interval: 'monthly', platform: 'android'},
  memento_pro_annual: {interval: 'annual', platform: 'android'},
};

export async function verifyIapPurchase(userId: string, body: IapVerifyBody) {
  const {platform, productId, transactionId, receiptData, purchaseToken} = body;

  const skuConfig = ALLOWED_IAP_SKUS[productId];
  if (!skuConfig || skuConfig.platform !== platform) {
    throw new BadRequestException(
      `Unrecognized or unsupported in-app purchase product: ${productId} for platform ${platform}`,
    );
  }

  const provider: 'apple' | 'google' = platform === 'ios' ? 'apple' : 'google';

  // 1. Cryptographic / Store-Backed Verification (Fail-Closed)
  let verified: VerifiedStorePurchase;

  if (platform === 'ios') {
    const rawReceipt = (receiptData || purchaseToken || '').trim();
    if (!rawReceipt) {
      throw new BadRequestException(
        'StoreKit receiptData or purchaseToken is required for iOS verification',
      );
    }

    try {
      verified = await verifyAppleStoreKit2Jws(rawReceipt, productId);
    } catch (jwsErr: any) {
      const looksLikeJws = rawReceipt.split('.').length === 3;
      if (!looksLikeJws && process.env.APPLE_SHARED_SECRET) {
        verified = await verifyLegacyAppleReceipt(rawReceipt, productId);
      } else {
        throw jwsErr;
      }
    }
  } else {
    // Android / Google Play Billing
    const token = (purchaseToken || receiptData || '').trim();
    if (!token) {
      throw new BadRequestException(
        'Google Play purchaseToken is required for Android verification',
      );
    }

    verified = await verifyGooglePlayPurchase(token, productId);
  }

  const {subscription, alreadyApplied} = await applyStoreSubscriptionSnapshot({
    userId,
    snapshot: {
      provider,
      environment: verified.environment ?? 'Production',
      transactionId: verified.verifiedTransactionId,
      chainAliases: verified.chainAliases ?? [
        verified.originalTransactionId ?? verified.verifiedTransactionId,
      ],
      storeAccountToken: verified.storeAccountToken,
      productId,
      billingInterval: skuConfig.interval,
      purchaseDate: verified.purchaseDate,
      expiresAt: verified.expiresAt,
      entitlementStatus: 'active',
      entitlementActive: true,
      autoRenewEnabled: verified.autoRenewEnabled,
      providerModifiedAt: verified.providerModifiedAt ?? verified.expiresAt,
      eventType: 'CLIENT_VERIFICATION',
      sanitizedMetadata: verified.rawPayload,
    },
  });

  if (!subscription) {
    throw new ServiceUnavailableException(
      'Failed to activate subscription after store verification',
    );
  }

  return {
    message: alreadyApplied
      ? 'Transaction already verified'
      : 'In-app purchase verified successfully',
    data: {
      success: true,
      tier: subscription.tier,
      status: subscription.status,
      expiresAt: verified.expiresAt.toISOString(),
    },
  };
}
