import {model, Schema, Types} from 'mongoose';

export interface IPersona {
  _id?: string;
  user: string;
  important_notes?: string[];
  key_preferences?: string[];
  conversation_history_summary?: string;
  emotional_state_trends?: string[];
  goals_and_aspirations?: string[];
  self_description?: string;
  current_priority?: string[];
  join_reasons?: string[];
  motivation?: string;
  open_threads?: string[];
  audience?: string[];
  communication_style?: string[];
  last_array_update?: Date;
  last_summarized_at?: Date;
  last_update?: Record<string, Date>; // Per-field update timestamps
  last_summarized?: Record<string, Date>; // Per-field summarization timestamps
  /** AI-written Memory Insights modal summary (cached). */
  memory_insights_summary?: string;
  memory_insights_summary_at?: Date;
  created_at: string;
  updated_at: string;
}

const persona = new Schema<IPersona>(
  {
    user: {
      type: String,
      ref: 'user',
      required: true,
      unique: true,
    },
    important_notes: [String],
    key_preferences: [String],
    conversation_history_summary: String,
    emotional_state_trends: [String],
    goals_and_aspirations: [String],
    self_description: String,
    current_priority: [String],
    join_reasons: [String],
    motivation: String,
    open_threads: [String],
    audience: [String],
    communication_style: [String],
    last_array_update: Date,
    last_summarized_at: Date,
    last_update: {
      type: Map,
      of: Date,
      default: {},
    },
    last_summarized: {
      type: Map,
      of: Date,
      default: {},
    },
    memory_insights_summary: String,
    memory_insights_summary_at: Date,
  },
  {
    timestamps: {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    toJSON: {virtuals: true},
    toObject: {virtuals: true},
  },
);

const Persona = model<IPersona>('persona', persona);
export default Persona;
