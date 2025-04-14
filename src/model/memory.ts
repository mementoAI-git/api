import { model, PaginateModel, Schema } from 'mongoose';
import mongoosePaginate from 'mongoose-paginate-v2';

export interface IMemory {
  title: string
  body: string
  user: string
  attachments: string[]
  tags: string[]
  status: string // draft
  level: number
  refrence: string
  prompt?: string
  last_opened: string
  created_at: string
}

const memory = new Schema<IMemory>({
  title: String,
  body: String,
  user: String,
  attachments: [{
    type: String,
    ref: "file"
  }],
  tags: String,
  level: Number,
  refrence: String,
  prompt: {
    type: String,
    default: "prompt"
  },
  last_opened: Date,
}, {
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  }
})

memory.plugin(mongoosePaginate)

const Memory = model<IMemory, PaginateModel<IMemory>>("memory", memory)
export default Memory