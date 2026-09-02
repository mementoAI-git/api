import {model, PaginateModel, Schema} from 'mongoose';
import mongoosePaginate from 'mongoose-paginate-v2';
import {IUser} from './user';
import './beneficiary';

export type CapsuleDeliveryStatus =
  | 'pending'
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'failed';

export interface ICapsuleRecipientSnapshot {
  recipient_id: string;
  beneficiary_id?: string;
  linked_user_id?: string;
  email: string;
  display_name?: string;
  delivery_status: CapsuleDeliveryStatus;
  last_attempt_at?: Date;
  delivered_at?: Date;
  provider_message_id?: string;
  failure_code?: string;
}

export interface ICapsuleRecipientInput {
  recipient_id?: string;
  beneficiary_id?: string;
  linked_user_id?: string;
  email: string;
  display_name?: string;
}

export interface ICapsuleStyle {
  themeId?: string;
  backgroundColor?: string;
  fontSize?: string;
  textColor?: string;
  headerColor?: string;
}

export interface ICapsule {
  user: string | IUser;
  /** Sender – ref to User who sent the capsule. Set for status "received". */
  benefactor?: string;
  /** Self-ref to the sent capsule. Set on received capsules. */
  source?: string;
  recipients: Array<string | ICapsuleRecipientInput>;
  recipient_snapshots?: ICapsuleRecipientSnapshot[];
  recipients_snapshot_version?: number;
  schedule_date?: string;
  title: string;
  body: string;
  attachments: string[];
  memories?: string[];
  style?: ICapsuleStyle;
  status: string; // draft scheduled delivered failed pause received
  viewed_at?: Date;
  /** True when the sender account was purged after delivery. */
  sender_anonymized?: boolean;
  sender_anonymized_at?: Date;
  created_at: string;
  updated_at: string;
}

const recipientSnapshot = new Schema<ICapsuleRecipientSnapshot>(
  {
    recipient_id: {type: String, required: true},
    beneficiary_id: {type: String, ref: 'beneficiary'},
    linked_user_id: {type: String, ref: 'user'},
    email: {type: String, required: true, lowercase: true, trim: true},
    display_name: String,
    delivery_status: {
      type: String,
      enum: ['pending', 'queued', 'sent', 'delivered', 'failed'],
      default: 'pending',
      required: true,
    },
    last_attempt_at: Date,
    delivered_at: Date,
    provider_message_id: String,
    failure_code: String,
  },
  {_id: false},
);

const capsule = new Schema<ICapsule>(
  {
    user: {
      type: String,
      index: true,
      ref: 'user',
    },
    benefactor: {
      type: String,
      ref: 'user',
      index: true,
    },
    source: {
      type: String,
      ref: 'capsule',
      index: true,
    },
    recipients: [{type: String, ref: 'beneficiary'}],
    recipient_snapshots: {type: [recipientSnapshot], default: undefined},
    recipients_snapshot_version: {type: Number, default: 1},
    schedule_date: Date,
    title: String,
    body: String,
    attachments: [
      {
        type: String,
        ref: 'file',
      },
    ],
    memories: [
      {
        type: String,
        ref: 'memory',
      },
    ],
    style: {
      themeId: String,
      backgroundColor: String,
      fontSize: String,
      textColor: String,
      headerColor: String,
    },
    status: String,
    viewed_at: Date,
    sender_anonymized: {type: Boolean, default: false},
    sender_anonymized_at: {type: Date, default: null},
  },
  {
    timestamps: {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
);

capsule.plugin(mongoosePaginate);
capsule.index(
  {source: 1, user: 1},
  {
    unique: true,
    partialFilterExpression: {source: {$type: 'string'}, status: 'received'},
  },
);

const Capsule = model<ICapsule, PaginateModel<ICapsule>>('capsule', capsule);
export default Capsule;
