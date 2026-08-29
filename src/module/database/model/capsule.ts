import {model, PaginateModel, Schema} from 'mongoose';
import mongoosePaginate from 'mongoose-paginate-v2';
import {IUser} from './user';
import './beneficiary';

export interface ICapsule {
  user: string | IUser;
  /** Sender – ref to User who sent the capsule. Set for status "received". */
  benefactor?: string;
  /** Self-ref to the sent capsule. Set on received capsules. */
  source?: string;
  recipients: string[];
  schedule_date?: string;
  title: string;
  body: string;
  attachments: string[];
  memories?: string[];
  status: string; // draft scheduled delivered failed pause received
  viewed_at?: Date;
  /** True when the sender account was purged after delivery. */
  sender_anonymized?: boolean;
  sender_anonymized_at?: Date;
  created_at: string;
  updated_at: string;
}

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

const Capsule = model<ICapsule, PaginateModel<ICapsule>>('capsule', capsule);
export default Capsule;
