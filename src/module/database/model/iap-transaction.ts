import {model, Schema} from 'mongoose';

export interface IIapTransaction {
  provider: 'apple' | 'google';
  transaction_id: string;
  transaction_key?: string;
  chain_id?: string;
  original_transaction_id?: string | null;
  user_id: string;
  product_id: string;
  status: 'active' | 'expired' | 'revoked';
  expires_at: Date;
  purchase_date?: Date | null;
  raw_payload?: Record<string, unknown> | null;
  provider_modified_at?: Date | null;
  event_type?: string | null;
  environment?: 'Production' | 'Sandbox' | 'Test' | null;
  created_at?: Date;
  updated_at?: Date;
}

const iapTransaction = new Schema<IIapTransaction>(
  {
    provider: {
      type: String,
      required: true,
      enum: ['apple', 'google'],
      index: true,
    },
    transaction_id: {type: String, required: true, index: true},
    transaction_key: {type: String, default: null, index: true},
    chain_id: {type: String, default: null, index: true},
    original_transaction_id: {type: String, default: null, index: true},
    user_id: {type: String, required: true, index: true},
    product_id: {type: String, required: true},
    status: {
      type: String,
      enum: ['active', 'expired', 'revoked'],
      default: 'active',
      index: true,
    },
    expires_at: {type: Date, required: true},
    purchase_date: {type: Date, default: null},
    raw_payload: {type: Schema.Types.Mixed, default: null},
    provider_modified_at: {type: Date, default: null},
    event_type: {type: String, default: null},
    environment: {
      type: String,
      enum: ['Production', 'Sandbox', 'Test', null],
      default: null,
    },
  },
  {
    timestamps: {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
);

iapTransaction.index({provider: 1, transaction_key: 1}, {unique: true});

const IapTransaction = model<IIapTransaction>(
  'iap_transaction',
  iapTransaction,
);
export default IapTransaction;
