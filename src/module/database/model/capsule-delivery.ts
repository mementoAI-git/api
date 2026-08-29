import {model, Schema} from 'mongoose';

export type CapsuleDeliveryAttemptStatus =
  | 'pending'
  | 'processing'
  | 'sent'
  | 'delivered'
  | 'failed';

export interface ICapsuleDelivery {
  capsule_id: string;
  recipient_id: string;
  recipient_email: string;
  linked_user_id?: string;
  status: CapsuleDeliveryAttemptStatus;
  attempt_count: number;
  last_attempt_at?: Date;
  delivered_at?: Date;
  provider_message_id?: string;
  failure_code?: string;
  received_capsule_id?: string;
  view_token_lookup?: string;
  view_token_hash?: string;
  view_token_expires_at?: Date;
  token_exchanged_at?: Date;
  view_grant_lookup?: string;
  view_grant_hash?: string;
  view_grant_expires_at?: Date;
  revoked_at?: Date;
  created_at: Date;
  updated_at: Date;
}

const capsuleDeliverySchema = new Schema<ICapsuleDelivery>(
  {
    capsule_id: {type: String, required: true, ref: 'capsule', index: true},
    recipient_id: {type: String, required: true},
    recipient_email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    linked_user_id: {type: String, ref: 'user', index: true},
    status: {
      type: String,
      enum: ['pending', 'processing', 'sent', 'delivered', 'failed'],
      required: true,
      default: 'pending',
    },
    attempt_count: {type: Number, required: true, default: 0},
    last_attempt_at: Date,
    delivered_at: Date,
    provider_message_id: String,
    failure_code: String,
    received_capsule_id: {type: String, ref: 'capsule'},
    view_token_lookup: {type: String, index: true, select: false},
    view_token_hash: {type: String, select: false},
    view_token_expires_at: {type: Date, select: false},
    token_exchanged_at: {type: Date, select: false},
    view_grant_lookup: {type: String, index: true, select: false},
    view_grant_hash: {type: String, select: false},
    view_grant_expires_at: {type: Date, select: false},
    revoked_at: {type: Date, select: false},
  },
  {timestamps: {createdAt: 'created_at', updatedAt: 'updated_at'}},
);

capsuleDeliverySchema.index({capsule_id: 1, recipient_id: 1}, {unique: true});
capsuleDeliverySchema.index({status: 1, last_attempt_at: 1});

const CapsuleDelivery = model<ICapsuleDelivery>(
  'capsule_delivery',
  capsuleDeliverySchema,
);
export default CapsuleDelivery;
