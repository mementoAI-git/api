import { model, PaginateModel, Schema } from "mongoose"
import mongoosePaginate from 'mongoose-paginate-v2';

export interface ICapsule {
  user: string
  recipients: string[]
  delivery_date: string
  title: string
  body: string
  attachments: string[]
  status: string // Scheduled draft delivered failed
  created_at: string
  updated_at: string
}

const capsule = new Schema<ICapsule>({
  user: {
    type: String,
    index: true
  },
  recipients: [{ type: String, ref: "beneficiary" }],
  delivery_date: Date,
  title: String,
  body: String,
  attachments: [{
    type: String,
    ref: "file"
  }],
  status: String
}, {
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  }
})

capsule.plugin(mongoosePaginate)

const Capsule = model<ICapsule, PaginateModel<ICapsule>>("capsule", capsule)
export default Capsule