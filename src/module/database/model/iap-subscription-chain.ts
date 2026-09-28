import {model, Schema} from 'mongoose';

export type StoreProvider = 'apple' | 'google';
export type StoreEnvironment = 'Production' | 'Sandbox' | 'Test';
export type StoreEntitlementStatus =
  | 'active'
  | 'grace_period'
  | 'cancelled_pending_expiry'
  | 'past_due'
  | 'paused'
  | 'expired'
  | 'revoked'
  | 'pending';

export interface IIapSubscriptionChain {
  provider: StoreProvider;
  chain_id: string;
  user_id: string;
  store_account_token?: string | null;
  product_id: string;
  billing_interval: 'monthly' | 'annual';
  entitlement_status: StoreEntitlementStatus;
  entitlement_active: boolean;
  current_period_start?: Date | null;
  current_period_end?: Date | null;
  auto_renew_enabled?: boolean | null;
  latest_transaction_key?: string | null;
  latest_provider_token_encrypted?: string | null;
  environment?: StoreEnvironment | null;
  provider_modified_at?: Date | null;
  last_verified_at: Date;
  created_at?: Date;
  updated_at?: Date;
}

const schema = new Schema<IIapSubscriptionChain>(
  {
    provider: {type: String, required: true, enum: ['apple', 'google']},
    chain_id: {type: String, required: true, unique: true},
    user_id: {type: String, required: true, index: true},
    store_account_token: {type: String, default: null, index: true},
    product_id: {type: String, required: true},
    billing_interval: {
      type: String,
      required: true,
      enum: ['monthly', 'annual'],
    },
    entitlement_status: {
      type: String,
      required: true,
      enum: [
        'active',
        'grace_period',
        'cancelled_pending_expiry',
        'past_due',
        'paused',
        'expired',
        'revoked',
        'pending',
      ],
      index: true,
    },
    entitlement_active: {type: Boolean, required: true, index: true},
    current_period_start: {type: Date, default: null},
    current_period_end: {type: Date, default: null},
    auto_renew_enabled: {type: Boolean, default: null},
    latest_transaction_key: {type: String, default: null},
    latest_provider_token_encrypted: {
      type: String,
      default: null,
      select: false,
    },
    environment: {
      type: String,
      enum: ['Production', 'Sandbox', 'Test', null],
      default: null,
    },
    provider_modified_at: {type: Date, default: null},
    last_verified_at: {type: Date, required: true},
  },
  {timestamps: {createdAt: 'created_at', updatedAt: 'updated_at'}},
);

schema.index({provider: 1, user_id: 1});
schema.index({provider: 1, store_account_token: 1});
schema.index({entitlement_active: 1, last_verified_at: 1});

const IapSubscriptionChain = model<IIapSubscriptionChain>(
  'iap_subscription_chain',
  schema,
);

export default IapSubscriptionChain;
