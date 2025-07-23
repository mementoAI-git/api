import { model, Schema } from "mongoose"
import { IPrompt } from "./prompt"

interface IActivePrompt {
  prompt: string | IPrompt
  user: string
  created_at: string
  updated_at: string
}

const activePrompt = new Schema<IActivePrompt>({
  prompt: {
    type: String,
    ref: "prompt",
    index: true
  },
  user: {
    type: String,
    ref: "user",
    index: true
  }
}, {
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  }
})

const ActivePrompt = model<IActivePrompt>('activeprompt', activePrompt);
export default ActivePrompt;