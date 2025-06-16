import { model, PaginateModel, Schema } from "mongoose"
import mongoosePaginate from 'mongoose-paginate-v2';

export interface IBeneficiary {
  name: string
  email: string
  relationship: string
  status: string // pending accepted rejected
  level: number
  user: string
  accepted_at: string
}

const beneficiary = new Schema<IBeneficiary>({
  name: String,
  email: String,
  user: {
    type: String,
    ref: "user"
  },
  status: {
    type: String,
    default: "pending"
  },
  relationship: String,
  level: {
    type: Number,
    default: 1
  },
  accepted_at: Date
}, {
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  }
})

beneficiary.plugin(mongoosePaginate)

const Beneficiary = model<IBeneficiary, PaginateModel<IBeneficiary>>("beneficiary", beneficiary)
export default Beneficiary