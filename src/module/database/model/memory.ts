import { model, PaginateModel, Schema } from 'mongoose';
import mongoosePaginate from 'mongoose-paginate-v2';

export interface IMemory {
  _id?: string
  title: string
  body: string
  type: string // story conversation
  user: string
  attachments: string[]
  tags: string[]
  level: number
  refrence: string
  status: string | "draft" | "save" | "queued" | "on_chain" | "deleted";
  prompt?: string
  session_id?: string
  last_opened: string
  created_at: string
  updated_at?: string
  // AI context optimization fields
  summary?: string              // AI-generated conversation summary
  topics?: string[]             // Key topics discussed in this conversation
  last_summarized_at?: Date     // Track when the conversation was last summarized
  message_count?: number        // Track message count for summarization triggers
  last_active?: Date            // Track last activity for inactivity-based summarization
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
  session_id: String,
  last_opened: Date,
  summary: {
    type: String,
    default: null
  },
  topics: [String],
  last_summarized_at: {
    type: Date,
    default: null
  },
  message_count: {
    type: Number,
    default: 0
  },
  last_active: {
    type: Date,
    default: null
  }
}, {
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  }
})

memory.plugin(mongoosePaginate)

const Memory = model<IMemory, PaginateModel<IMemory>>("memory", memory)
export default Memory