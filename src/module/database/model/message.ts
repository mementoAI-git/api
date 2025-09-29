import { model, PaginateModel, Schema } from "mongoose"
import mongoosePaginate from 'mongoose-paginate-v2';

export interface IMessage {
  user: string
  text: string
  role: string // user, ai
  attatchments: string[]
  memory: string
  is_voice: boolean
  created_at: string
  updated_at: string
}

const message = new Schema<IMessage>({
  user: String,
  text: String,
  role: String,
  memory: {
    type: String,
    ref: "memory",
    index: true
  },
  is_voice: {
    type: Boolean,
    default: false
  },
  attatchments: [{
    type: String,
    ref: "file"
  }]
}, {
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  }
})

message.plugin(mongoosePaginate)

const Message = model<IMessage, PaginateModel<IMessage>>("message", message)
export default Message