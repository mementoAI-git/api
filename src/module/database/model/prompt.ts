import { model, PaginateModel, Schema } from "mongoose"
import mongoosePaginate from 'mongoose-paginate-v2';

export interface IPrompt {
  _id?: string
  title: string
  type: string
  tags: string[]
  created_at: string
  updated_at: string
}

const prompt = new Schema<IPrompt>({
  title: String,
  type: String,
  tags: [String]
}, {
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  }
})

prompt.plugin(mongoosePaginate)

const Prompt = model<IPrompt, PaginateModel<IPrompt>>('prompt', prompt);
export default Prompt;