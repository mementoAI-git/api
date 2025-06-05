import { model, Schema } from "mongoose"

export interface ICapsule {
  recipients: string[]
  delivery_date: string
  title: string
  body: string
  attachments: string[]
  status: string
  created_at: string
  updated_at: string
}

const capsule = new Schema<ICapsule>({
  recipients: [String],
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

const Capsule = model("capsule", capsule)
export default Capsule