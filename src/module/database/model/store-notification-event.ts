import {model, Schema} from 'mongoose';
import type {StoreProvider} from './iap-subscription-chain';

export type StoreNotificationStatus =
  | 'pending'
  | 'processing'
  | 'applied'
  | 'ignored'
  | 'unmapped'
  | 'failed';

export interface IStoreNotificationEvent {
  provider: StoreProvider;
  event_id: string;
  event_type: string;
  subtype?: string | null;
  status: StoreNotificationStatus;
  user_id?: string | null;
  chain_id?: string | null;
  provider_published_at?: Date | null;
  received_at: Date;
  processed_at?: Date | null;
  attempts: number;
  last_error?: string | null;
  normalized_payload?: Record<string, unknown> | null;
  encrypted_provider_token?: string | null;
  created_at?: Date;
  updated_at?: Date;
}

const schema = new Schema<IStoreNotificationEvent>(
  {
    provider: {type: String, required: true, enum: ['apple', 'google']},
    event_id: {type: String, required: true},
    event_type: {type: String, required: true},
    subtype: {type: String, default: null},
    status: {
      type: String,
      required: true,
      enum: [
        'pending',
        'processing',
        'applied',
        'ignored',
        'unmapped',
        'failed',
      ],
      default: 'pending',
      index: true,
    },
    user_id: {type: String, default: null, index: true},
    chain_id: {type: String, default: null, index: true},
    provider_published_at: {type: Date, default: null},
    received_at: {type: Date, required: true, default: Date.now},
    processed_at: {type: Date, default: null},
    attempts: {type: Number, required: true, default: 0},
    last_error: {type: String, default: null},
    normalized_payload: {type: Schema.Types.Mixed, default: null},
    encrypted_provider_token: {type: String, default: null, select: false},
  },
  {timestamps: {createdAt: 'created_at', updatedAt: 'updated_at'}},
);

schema.index({provider: 1, event_id: 1}, {unique: true});
schema.index({status: 1, received_at: 1});

const StoreNotificationEvent = model<IStoreNotificationEvent>(
  'store_notification_event',
  schema,
);
export default StoreNotificationEvent;
