export const BENEFICIARY_ACCESS_SCOPES = [
  'shared_only',
  'full_vault',
  'memories_only',
  'capsules_only',
  'documents_only',
] as const;

export type BeneficiaryAccessScope = (typeof BENEFICIARY_ACCESS_SCOPES)[number];

import {model, PaginateModel, Schema} from 'mongoose';
import mongoosePaginate from 'mongoose-paginate-v2';

export interface IBeneficiary {
  id?: string;
  name: string;
  email: string;
  relationship: string;
  access_scope?: BeneficiaryAccessScope;
  about?: string;
  avatar_file_id?: string | null;
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
    avatar_file_id: {type: String, ref: 'file', default: null},
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
    access_scope: {
      type: String,
      enum: BENEFICIARY_ACCESS_SCOPES,
      default: 'full_vault',
    },
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
