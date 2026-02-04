import { model, PaginateModel, Schema } from "mongoose"
import mongoosePaginate from 'mongoose-paginate-v2';

export interface ICapsule {
  user: string
  recipients: string[]
  schedule_date?: string
  title: string
  body: string
  attachments: string[]
  memories?: string[]
  status: string // scheduled draft delivered failed pause
  created_at: string
  updated_at: string
}

const capsule = new Schema<ICapsule>({
  user: {
    type: String,
    index: true
  },
  recipients: [{ type: String, ref: "beneficiary" }],
  schedule_date: Date,
  title: String,
  body: String,
  attachments: [{
    type: String,
    ref: "file"
  }],
  memories: [{
    type: String,
    ref: "memory"
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