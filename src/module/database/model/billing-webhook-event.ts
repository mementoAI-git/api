import {model, Schema} from 'mongoose';

export interface IBillingWebhookEvent {
  provider: 'polar' | 'paystack';
  event_id: string;
  event_type?: string;
  /** Optional identity metadata for purge/reconciliation; older rows omit it. */
  user_id?: string | null;
  provider_customer_id?: string | null;
  processed_at?: Date;
  created_at?: Date;
  updated_at?: Date;
}

const billingWebhookEvent = new Schema<IBillingWebhookEvent>(
  {
    provider: {
      type: String,
      required: true,
      enum: ['polar', 'paystack'],
      index: true,
    },
    event_id: {type: String, required: true},
    event_type: {type: String, default: null},
    user_id: {type: String, default: null, index: true},
    provider_customer_id: {type: String, default: null},
    processed_at: {type: Date, default: () => new Date()},
  },
  {
    timestamps: {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
);

billingWebhookEvent.index({provider: 1, event_id: 1}, {unique: true});

const BillingWebhookEvent = model<IBillingWebhookEvent>(
  'billing_webhook_event',
  billingWebhookEvent,
);
export default BillingWebhookEvent;
