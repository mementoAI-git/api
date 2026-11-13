import dayjs from 'dayjs';
import {StatusCodes} from 'http-status-codes';
import {FREE_STORAGE_LIMIT_BYTES} from '../../../utils/constant';
import {
  STAGING_AUTO_PRO,
  STORAGE_LIMIT_LEGACY_BYTES,
  STORAGE_LIMIT_PRO_BYTES,
} from '../../../utils/config';
import {ServiceError} from '../../../utils/service-error';
import Subscription, {
  type ISubscription,
  type SubscriptionTier,
} from '../../database/model/subscription';
import Usage, {type IUsage} from '../../database/model/usage';

type FeatureKey =
  | 'voice_mode'
  | 'supermemory'
  | 'upload_quality'
  | 'storage'
  | 'time_capsule_window'
  | 'beneficiaries'
  | 'timed_messages'
  | 'chat.voice_mode'
  | 'capsule.scheduling_window'
  | 'billing.usage_limits';

export interface SubscriptionGatePayload {
  error: 'subscription_required';
  feature: string;
  requiredTier: 'pro' | 'legacy';
  message: string;
}

export interface FeatureAccessResult {
  allowed: boolean;
  reason?: string;
  requiredTier?: 'pro' | 'legacy';
}

export interface AccessContext {
  deliveryDate?: string | Date | null;
  usagePatch?: Partial<IUsage>;
  additionalBytes?: number;
}

const FEATURE_ALIASES: Record<string, FeatureKey> = {
  'chat.voice_mode': 'voice_mode',
  'capsule.scheduling_window': 'time_capsule_window',
  'billing.usage_limits': 'storage',
};

const FEATURE_MESSAGES: Record<string, string> = {
  voice_mode: 'Voice mode requires Pro or Legacy.',
  supermemory: 'Supermemory requires Pro or Legacy.',
  upload_quality: 'High-quality uploads require Pro or Legacy.',
  storage: 'Storage limit reached. Upgrade to continue uploading.',
  time_capsule_window: 'Free plans can only schedule up to 6 months ahead.',
  beneficiaries: 'Free plans can only add up to 2 beneficiaries.',
  timed_messages: 'Free plans can only create up to 5 timed messages.',
};

function normalizeFeature(feature: string): FeatureKey {
  return FEATURE_ALIASES[feature] ?? (feature as FeatureKey);
}

function isPaidTier(tier: SubscriptionTier) {
  return tier === 'pro' || tier === 'legacy';
}

/**
 * Whether a paid tier is still paid for. With no provider behind it, the tier
 * came from a promo (or an older grant): an expired promo ends it, and with no
 * promo date it stands, as before. With a provider, its own end dates decide;
 * an expired promo no longer takes away a plan the member later paid for.
 */
export function providerIsPaying(subscription: ISubscription): boolean {
  const now = dayjs();
  const terminallyEnded =
    subscription.ended_at && dayjs(subscription.ended_at).isBefore(now);
  const periodEnded =
    subscription.current_period_end &&
    dayjs(subscription.current_period_end).isBefore(now);
  const providerEnded =
    terminallyEnded ||
    ((subscription.status === 'past_due' ||
      subscription.status === 'cancelled' ||
      subscription.cancel_at_period_end === true) &&
      periodEnded);
  if (providerEnded) return false;
  if (storePeriodLapsed(subscription)) return false;
  if (subscription.payment_provider) return true;
  return !subscription.promo_expires_at;
}

/** How long after a store period ends a renewal may still be on its way to us. */
const STORE_RENEWAL_GRACE_DAYS = 3;

/**
 * App Store and Play subscriptions only move forward when a store notice
 * arrives or the app re-verifies the purchase. A member who cancels in the
 * store's settings may send neither, so without this the record stayed
 * "active" and kept Pro forever. A renewal pushes current_period_end forward;
 * once it is a few days in the past with no renewal, the plan has ended.
 */
function storePeriodLapsed(subscription: ISubscription): boolean {
  if (
    subscription.payment_provider !== 'apple' &&
    subscription.payment_provider !== 'google'
  ) {
    return false;
  }
  return Boolean(
    subscription.current_period_end &&
      dayjs(subscription.current_period_end)
        .add(STORE_RENEWAL_GRACE_DAYS, 'day')
        .isBefore(dayjs()),
  );
}

export function resolveEffectiveTier(
  subscription: ISubscription | null,
): SubscriptionTier {
  // Applies to all staging accounts, even before a subscription is created or
  // after a sandbox purchase expires. Provider records remain authoritative
  // outside staging and are never rewritten by this entitlement.
  if (STAGING_AUTO_PRO) return 'pro';
  if (!subscription) return 'free';
  if (isPaidTier(subscription.tier)) {
    // A promo still running grants its plan, whatever a past subscription did.
    if (
      subscription.promo_expires_at &&
      !dayjs(subscription.promo_expires_at).isBefore(dayjs())
    ) {
      return subscription.tier;
    }
    if (!providerIsPaying(subscription)) return 'free';
  }
  return subscription.tier ?? 'free';
}

function defaultUsage(): IUsage {
  return {
    user_id: '',
    storage_used_bytes: 0,
    storage_limit_bytes: FREE_STORAGE_LIMIT_BYTES,
    storage_reserved_bytes: 0,
    beneficiary_count: 0,
    timed_message_count: 0,
    time_capsule_count: 0,
    memory_integration_count: 0,
  };
}

export function buildSubscriptionRequiredPayload(
  feature: string,
  requiredTier: 'pro' | 'legacy' = 'pro',
): SubscriptionGatePayload {
  const normalized = normalizeFeature(feature);
  return {
    error: 'subscription_required',
    feature: normalized,
    requiredTier,
    message:
      FEATURE_MESSAGES[normalized] ?? 'This feature requires an upgraded plan.',
  };
}

export function throwSubscriptionRequired(
  feature: string,
  requiredTier: 'pro' | 'legacy' = 'pro',
): never {
  throw new ServiceError(
    buildSubscriptionRequiredPayload(feature, requiredTier).message,
    StatusCodes.PAYMENT_REQUIRED,
    buildSubscriptionRequiredPayload(feature, requiredTier),
  );
}

export async function checkFeatureAccess(
  userId: string,
  feature: string,
  context: AccessContext = {},
): Promise<FeatureAccessResult> {
  const normalized = normalizeFeature(feature);
  const [subscription, usageDoc] = await Promise.all([
    Subscription.findOne({user_id: userId}).lean(),
    Usage.findOne({user_id: userId}).lean(),
  ]);

  const effectiveTier = resolveEffectiveTier(subscription);
  if (isPaidTier(effectiveTier) && normalized !== 'storage') {
    return {allowed: true};
  }

  const usage = {
    ...defaultUsage(),
    ...(usageDoc ?? {}),
    ...(context.usagePatch ?? {}),
  };

  switch (normalized) {
    case 'voice_mode':
    case 'supermemory':
    case 'upload_quality':
      return {
        allowed: false,
        requiredTier: 'pro',
        reason: FEATURE_MESSAGES[normalized],
      };
    case 'storage': {
      const limit =
        effectiveTier === 'pro'
          ? STORAGE_LIMIT_PRO_BYTES
          : effectiveTier === 'legacy'
            ? STORAGE_LIMIT_LEGACY_BYTES
            : FREE_STORAGE_LIMIT_BYTES;
      const usedWithIncoming =
        (usage.storage_used_bytes || 0) + (context.additionalBytes || 0);
      if (usedWithIncoming > limit) {
        return {
          allowed: false,
          requiredTier: 'pro',
          reason: FEATURE_MESSAGES.storage,
        };
      }
      return {allowed: true};
    }
    case 'beneficiaries':
      if ((usage.beneficiary_count || 0) >= 2) {
        return {
          allowed: false,
          requiredTier: 'pro',
          reason: FEATURE_MESSAGES.beneficiaries,
        };
      }
      return {allowed: true};
    case 'timed_messages':
      if ((usage.timed_message_count || 0) >= 5) {
        return {
          allowed: false,
          requiredTier: 'pro',
          reason: FEATURE_MESSAGES.timed_messages,
        };
      }
      return {allowed: true};
    case 'time_capsule_window': {
      if (!context.deliveryDate) return {allowed: true};
      const now = dayjs();
      const maxDate = now.add(6, 'month');
      if (dayjs(context.deliveryDate).isAfter(maxDate)) {
        return {
          allowed: false,
          requiredTier: 'pro',
          reason: FEATURE_MESSAGES.time_capsule_window,
        };
      }
      return {allowed: true};
    }
    default:
      return {allowed: true};
  }
}
