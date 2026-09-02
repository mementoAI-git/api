import {model, Schema} from 'mongoose';

export type SubscriptionTier = 'free' | 'pro' | 'legacy';
export type SubscriptionStatus =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'cancelled'
  | 'paused';
export type BillingInterval = 'monthly' | 'annual' | 'lifetime' | null;
export type PaymentProvider = 'paystack' | 'polar';
export type SubscriptionCurrency = 'USD' | 'NGN';

export interface ISubscription {
  user_id: string;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  billing_interval: BillingInterval;
  current_period_start?: Date | null;
  current_period_end?: Date | null;
  trial_ends_at?: Date | null;
  has_used_trial: boolean;
  cancelled_at?: Date | null;
  cancel_at_period_end?: boolean;
  ended_at?: Date | null;
  provider_modified_at?: Date | null;
  payment_provider?: PaymentProvider | null;
  provider_customer_id?: string | null;
  provider_subscription_id?: string | null;
  promo_code_used?: string | null;
  promo_expires_at?: Date | null;
  currency?: SubscriptionCurrency | null;
  country?: string | null;
  created_at?: Date;
  updated_at?: Date;
}

const subscription = new Schema<ISubscription>(
  {
    user_id: {type: String, required: true, index: true, unique: true},
    tier: {
      type: String,
      enum: ['free', 'pro', 'legacy'],
      default: 'free',
      index: true,
    },
    status: {
      type: String,
      enum: ['active', 'trialing', 'past_due', 'cancelled', 'paused'],
      default: 'active',
      index: true,
    },
    billing_interval: {
      type: String,
      enum: ['monthly', 'annual', 'lifetime', null],
      default: null,
    },
    current_period_start: {type: Date, default: null},
    current_period_end: {type: Date, default: null},
    trial_ends_at: {type: Date, default: null},
    has_used_trial: {type: Boolean, default: false},
    cancelled_at: {type: Date, default: null},
    cancel_at_period_end: {type: Boolean, default: false},
    ended_at: {type: Date, default: null},
    provider_modified_at: {type: Date, default: null},
    payment_provider: {
      type: String,
      enum: ['paystack', 'polar', null],
      default: null,
    },
    provider_customer_id: {type: String, default: null},
    provider_subscription_id: {type: String, default: null},
    promo_code_used: {type: String, default: null},
    promo_expires_at: {type: Date, default: null},
    currency: {type: String, enum: ['USD', 'NGN', null], default: null},
    country: {type: String, default: null},
  },
  {
    timestamps: {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
);

const Subscription = model<ISubscription>('subscription', subscription);
export default Subscription;
