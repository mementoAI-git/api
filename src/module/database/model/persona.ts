import { model, Schema, Types } from 'mongoose';

export interface IPersona {
  _id?: string
  user: string
  important_notes?: string[]
  key_preferences?: string[]
  conversation_history_summary?: string
  emotional_state_trends?: string[]
  goals_and_aspirations?: string[]
  self_description?: string
  current_priority?: string
  join_reasons?: string[]
  last_array_update?: Date
  last_summarized_at?: Date
  created_at: string
  updated_at: string
}

const persona = new Schema<IPersona>({
  user: {
    type: String,
    ref: 'user',
    required: true,
    unique: true
  },
  important_notes: [String],
  key_preferences: [String],
  conversation_history_summary: String,
  emotional_state_trends: [String],
  goals_and_aspirations: [String],
  self_description: String,
  current_priority: String,
  join_reasons: [String],
  last_array_update: Date,
  last_summarized_at: Date
}, {
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
})

const Persona = model<IPersona>('persona', persona);
export default Persona;

