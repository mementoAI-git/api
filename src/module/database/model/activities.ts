import { model, Schema } from "mongoose"

export interface IActivity {
  user: string
  title: string
  type: string
  created_at: string
}

const activity = new Schema<IActivity>({
  user: String,
  title: String,
  type: String
}, {
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  }
})

const Activity = model("activity", activity)
export default Activity