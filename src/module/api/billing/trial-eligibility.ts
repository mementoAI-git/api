import type {ISubscription} from '../../database/model/subscription';

type BillingHistory = Partial<
  Pick<
    ISubscription,
    | 'has_used_trial'
    | 'provider_subscription_id'
    | 'trial_ends_at'
    | 'current_period_end'
    | 'billing_interval'
    | 'status'
  >
>;

/**
 * Trials are for first-time subscribers. The other fields are only written by a
 * real subscription or store purchase, so they cover members who subscribed
 * before `has_used_trial` was recorded. Starting a checkout and promo codes set
 * none of them, so neither costs a member their trial.
 */
export function hasUsedTrial(subscription?: BillingHistory | null) {
  return Boolean(
    subscription &&
      (subscription.has_used_trial ||
        subscription.provider_subscription_id ||
        subscription.trial_ends_at ||
        subscription.current_period_end ||
        subscription.billing_interval ||
        subscription.status === 'cancelled'),
  );
}
