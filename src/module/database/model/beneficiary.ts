import {model, PaginateModel, Schema} from 'mongoose';
import mongoosePaginate from 'mongoose-paginate-v2';

export interface IBeneficiary {
  id?: string;
  name: string;
  email: string;
  relationship: string;
  about?: string;
  status: string; // pending accepted rejected
  level: number;
  /** Display color index 0–6 (optional; clients may hash id when unset) */
  color?: number;
  user: string;
  benefactor: string;
  accepted_at: string;
  due_at?: string;
  created_at: string;
}

const beneficiary = new Schema<IBeneficiary>(
  {
    name: String,
    email: String,
    about: {type: String, default: ''},
    user: {
      type: String,
      ref: 'user',
      index: true,
    },
    benefactor: {
      type: String,
      ref: 'user',
      index: true,
    },
    status: {
      type: String,
      default: 'pending',
    },
    relationship: String,
    level: {
      type: Number,
      default: 1,
    },
    color: {
      type: Number,
      min: 0,
      max: 6,
    },
    accepted_at: Date,
    due_at: Date,
  },
  {
    timestamps: {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
);

beneficiary.plugin(mongoosePaginate);

const Beneficiary = model<IBeneficiary, PaginateModel<IBeneficiary>>(
  'beneficiary',
  beneficiary,
);
export default Beneficiary;
