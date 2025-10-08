import { model, PaginateModel, Schema } from 'mongoose';
import mongoosePaginate from 'mongoose-paginate-v2';

export interface IMemory {
  title: string
  body: string
  type: string // story conversation
  user: string
  attachments: string[]
  tags: string[]
  level: number
  refrence: string
  status: string | "draft" | "save" | "queued" | "on_chain";
  prompt?: string
  last_opened: string
  created_at: string
}

const memory = new Schema<IMemory>({
  title: String,
  body: String,
  user: String,
  type: {
    type: String,
    default: "story"
  },
  status: {
    type: String,
    default: "draft"
  },
  attachments: [{
    type: String,
    ref: "file"
  }],
  tags: [String],
  level: {
    type: Number,
    default: 1
  },
  refrence: String,
  prompt: String,
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