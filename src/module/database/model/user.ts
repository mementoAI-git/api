import dayjs from 'dayjs';
import { model, Schema } from 'mongoose';
import { BACKEND_URL } from '../../../utils/config';
import { isEmpty } from '../../../utils/helpers';

// Add to User model
interface IUserPreferences {
  communication_style?: 'formal' | 'casual' | 'friendly' | 'professional'
  topics_of_interest?: string[]
  conversation_tone?: 'upbeat' | 'calm' | 'analytical' | 'creative'
  response_length?: 'short' | 'medium' | 'long'
}
interface IUserContext {
  important_notes?: string[]
  key_preferences?: string[]
  conversation_history_summary?: string
  emotional_state_trends?: string[]
  goals_and_aspirations?: string[]
  self_description?: string
  current_priority?: string
  join_reasons?: string[]
}
export interface IUser {
  _id?: string
  email: string
  first_name: string
  last_name: string
  nickname: string
  gender: string
  phone_number: string
  dob: string
  country: string
  password: string
  onbaorded: boolean
  providers: string[]
  preferences: IUserPreferences
  context: IUserContext
  verified: boolean
  private_key: string
  public_key: string
  refresh_token?: string
  two_factor: {
    secret: string
    enabled: boolean
  }
  picture: string
  picture_url?: string
  last_seen: string
  streak: number
  bg_music?: string
  chat_voice?: string
  fullname?: string | null
  newsletter_subscriber: boolean
  created_at: string
}

const user = new Schema<IUser>({
  email: {
    type: String,
    unique: true,
    lowercase: true
  },
  first_name: String,
  last_name: String,
  nickname: String,
  gender: String,
  dob: Date,
  country: String,
  password: String,
  private_key: String,
  public_key: String,
  refresh_token: String,
  bg_music: {
    type: String,
    default: null
  },
  chat_voice: {
    type: String,
    default: null
  },
  two_factor: {
    secret: {
      type: String,
      default: null
    },
    enabled: {
      type: Boolean,
      default: false
    }
  },
  providers: [String],
  phone_number: String,
  onbaorded: {
    type: Boolean,
    default: false,
  },
  verified: {
    type: Boolean,
    default: false
  },
  newsletter_subscriber: {
    type: Boolean,
    default: false
  },
  picture: String,
  last_seen: {
    type: String,
    default: () => dayjs().format("YYYY-MM-DD")
  },
  streak: {
    type: Number,
    default: 1
  },
  preferences: {
    communication_style: {
      type: String,
      enum: ['formal', 'casual', 'friendly', 'professional'],
      default: 'friendly'
    },
    topics_of_interest: [String],
    conversation_tone: {
      type: String,
      enum: ['upbeat', "warm", 'calm', 'analytical', 'creative'],
      default: 'warm'
    },
    response_length: {
      type: String,
      enum: ['short', 'medium', 'long'],
      default: 'medium'
    }
  },
  context: {
    important_notes: [String],
    key_preferences: [String],
    conversation_history_summary: String,
    emotional_state_trends: [String],
    goals_and_aspirations: [String],
    self_description: String,
    current_priority: String,
    join_reasons: [String]
  }
}, {
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
})

user.virtual('picture_url').get(function () {
  return this.picture ? `${BACKEND_URL}/files/${this.picture}` : null;
});
user.virtual('fullname').get(function () {
  return (isEmpty(this.first_name) && isEmpty(this.last_name)) ? null : `${this.first_name || ""} ${this.last_name || ""}`;
});

const User = model<IUser>('user', user);
export default User;
