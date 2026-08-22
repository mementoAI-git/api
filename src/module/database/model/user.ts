import dayjs from 'dayjs';
import {model, Schema} from 'mongoose';
import {BACKEND_URL} from '../../../utils/config';
import {concatStrings, isEmpty} from '../../../utils/helpers';
import {FREE_STORAGE_LIMIT_BYTES} from '../../../utils/constant';

// Add to User model
interface IUserPreferences {
  communication_style?: 'formal' | 'casual' | 'friendly' | 'professional';
  topics_of_interest?: string[];
  conversation_tone?: 'upbeat' | 'calm' | 'analytical' | 'creative';
  response_length?: 'short' | 'medium' | 'long';
  age_bracket?: string;
  priority_dimensions?: string[];
  expression_mode?: 'text' | 'voice' | 'mixed';
  chronotype?: string;
  sharing_intent?: string;
}

// TODO: to be remove after thorough test and confirmation
interface IUserContext {
  important_notes?: string[];
  key_preferences?: string[];
  conversation_history_summary?: string;
  emotional_state_trends?: string[];
  goals_and_aspirations?: string[];
  self_description?: string;
  current_priority?: string;
  join_reasons?: string[];
}

export interface IPasskey {
  credential_id: string; // base64url
  public_key: string; // base64url-encoded Uint8Array
  counter: number;
  device_name: string;
  created_at: Date;
}

export interface IUser {
  _id?: string;
  email: string;
  first_name: string;
  last_name: string;
  nickname: string;
  gender: string;
  phone_number: string;
  dob: string;
  country: string;
  password: string;
  /** never | skipped | completed */
  onboarding_status?: string;
  onboarding_step_reached?: number;
  skipped_deep_personalization?: boolean;
  providers: string[];
  preferences: IUserPreferences;
  context: IUserContext;
  verified: boolean;
  deleted: boolean;
  private_key: string;
  public_key: string;
  refresh_token?: string;
  refresh_tokens?: string[];
  two_factor: {
    secret: string;
    enabled: boolean;
  };
  picture: string;
  location?: string;
  age_range?: string;
  picture_url?: string;
  last_seen: string;
  last_task_date?: string;
  streak: number;
  bg_music?: string;
  chat_voice?: string;
  chat_voice_provider?: string;
  fullname?: string | null;
  newsletter_subscriber: boolean;
  created_at: string;
  storage_limit: number;
  primary_conversation_id?: string | null;
  passkeys?: IPasskey[];
}

const user = new Schema<IUser>(
  {
    email: {
      type: String,
      unique: true,
      lowercase: true,
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
    refresh_tokens: {
      type: [String],
      default: [],
    },
    bg_music: {
      type: String,
      default: null,
    },
    chat_voice: {
      type: String,
      default: null,
    },
    chat_voice_provider: {
      type: String,
      default: 'gemini',
    },
    two_factor: {
      secret: {
        type: String,
        default: null,
      },
      enabled: {
        type: Boolean,
        default: false,
      },
    },
    providers: [String],
    phone_number: String,
    onboarding_status: {
      type: String,
      enum: ['never', 'skipped', 'completed', 'in_progress'],
      default: 'never',
    },
    verified: {
      type: Boolean,
      default: false,
    },
    deleted: {
      type: Boolean,
      default: false,
    },
    newsletter_subscriber: {
      type: Boolean,
      default: false,
    },
    picture: String,
    last_seen: {
      type: String,
      default: () => dayjs().format('YYYY-MM-DD'),
    },
    last_task_date: {
      type: String,
      default: null,
    },
    streak: {
      type: Number,
      default: 1,
    },
    location: String,
    age_range: String,
    storage_limit: {
      type: Number,
      default: FREE_STORAGE_LIMIT_BYTES,
    },
    preferences: {
      communication_style: {
        type: String,
        enum: ['formal', 'casual', 'friendly', 'professional'],
        default: 'friendly',
      },
      topics_of_interest: [String],
      conversation_tone: {
        type: String,
        enum: ['upbeat', 'warm', 'calm', 'analytical', 'creative'],
        default: 'warm',
      },
      response_length: {
        type: String,
        enum: ['short', 'medium', 'long'],
        default: 'medium',
      },
      age_bracket: String,
      priority_dimensions: [String],
      expression_mode: {
        type: String,
        enum: ['text', 'voice', 'mixed'],
        default: 'text',
      },
      chronotype: String,
      sharing_intent: String,
    },
    onboarding_step_reached: {
      type: Number,
      default: null,
    },
    skipped_deep_personalization: {
      type: Boolean,
      default: false,
    },
    primary_conversation_id: {
      type: String,
      default: null,
    },
    passkeys: [
      {
        credential_id: {type: String, required: true},
        public_key: {type: String, required: true},
        counter: {type: Number, default: 0},
        device_name: {type: String, default: 'Unknown device'},
        created_at: {type: Date, default: Date.now},
      },
    ],
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

user.virtual('picture_url').get(function () {
  return this.picture ? `${BACKEND_URL}/files/${this.picture}` : null;
});
user.virtual('fullname').get(function () {
  return concatStrings(this.first_name, this.last_name, ' ').trim();
});

const User = model<IUser>('user', user);
export default User;
