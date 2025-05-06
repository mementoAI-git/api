import { model, PaginateModel, Schema } from "mongoose"
import mongoosePaginate from 'mongoose-paginate-v2';

export interface IBeneficiary {
  name: string
  email: string
  relationship: string
  level: number
  user: string
}

const beneficiary = new Schema<IBeneficiary>({
  name: String,
  email: String,
  user: {
    type: String,
    ref: "user"
  },
  relationship: String,
  level: {
    type: Number,
    default: 1
  }
}, {
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  }
})

beneficiary.plugin(mongoosePaginate)

const Beneficiary = model<IBeneficiary, PaginateModel<IBeneficiary>>("beneficiary", beneficiary)
export default Beneficiary