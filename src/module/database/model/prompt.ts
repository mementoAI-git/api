import { model, Schema } from "mongoose"

export interface IPrompt {
  title: string
  type: string
  tags: string[]
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

const Prompt = model<IPrompt>('prompt', prompt);
export default Prompt;