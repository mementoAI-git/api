import {model, Schema} from 'mongoose';
import {SocialAccounts, SOCIAL_PLATFORMS} from '../../../utils/social-accounts';

export interface IPersona {
  _id?: string;
  user: string;
  important_notes?: string[];
  key_preferences?: string[];
  conversation_history_summary?: string;
  emotional_state_trends?: string[];
  goals_and_aspirations?: string[];
  self_description?: string;
  social_accounts?: SocialAccounts;
  social_accounts_discovered_at?: Date;
  current_priority?: string[];
  join_reasons?: string[];
  motivation?: string;
  motivation_detail?: string;
  open_threads?: string[];
  audience?: string[];
  communication_style?: string[];
  life_situation?: string;
  life_situation_detail?: string;
  personality_traits?: string[];
  memory_treasures?: string[];
  last_array_update?: Date;
  last_summarized_at?: Date;
  last_update?: Record<string, Date>; // Per-field update timestamps
  last_summarized?: Record<string, Date>; // Per-field summarization timestamps
  /** AI-written Memory Insights modal summary (cached). */
  memory_insights_summary?: string;
  memory_insights_summary_at?: Date;
  /** Observations the member removed, so extraction does not add them back. */
  forgotten_observations?: string[];
  /** Permanently true once enrichment score ever reaches 20. Never reset. */
  beneficiary_access_unlocked?: boolean;
  created_at: string;
  updated_at: string;
}

const socialAccount = new Schema(
  {
    url: {type: String, required: true},
    source: {type: String, enum: ['user', 'ai'], required: true},
    confirmed_at: {type: Date, required: true},
    evidence: String,
    source_id: String,
  },
  {_id: false},
);
const socialAccounts = new Schema(
  Object.fromEntries(
    SOCIAL_PLATFORMS.map(platform => [
      platform,
      {type: socialAccount, default: undefined},
    ]),
  ),
  {_id: false},
);

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
    social_accounts: {type: socialAccounts, default: undefined},
    social_accounts_discovered_at: Date,
    current_priority: [String],
    join_reasons: [String],
    motivation: String,
    motivation_detail: String,
    open_threads: [String],
    audience: [String],
    communication_style: [String],
    life_situation: String,
    life_situation_detail: String,
    personality_traits: [String],
    memory_treasures: [String],
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
    forgotten_observations: {type: [String], default: undefined, select: false},
    beneficiary_access_unlocked: {
      type: Boolean,
      default: false,
    },
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
