import {model, PaginateModel, Schema} from 'mongoose';
import mongoosePaginate from 'mongoose-paginate-v2';

export interface IMessage {
  user: string;
  text: string;
  role: string; // user, ai
  ai_model?: string;
  attatchments: string[];
  memory: string;
  is_voice: boolean;
  duration: number;
  /** Voice call session this message came from; with voice_turn_index it makes voice writes idempotent. */
  voice_session_id?: string;
  voice_turn_index?: number;
  /** True when the AI turn was cut off by the user speaking. */
  voice_interrupted?: boolean;
  /** Original speech-to-text output, kept when post-call clean-up rewrote `text`. */
  raw_text?: string;
  /** True once post-call clean-up has rewritten this voice message. */
  voice_cleaned?: boolean;
  /** Quoted message the user is replying to — persisted so clients don't need to parse wrapper text */
  replyTo?: {role: string; text: string};
  created_at: string;
  updated_at: string;
}

const message = new Schema<IMessage>(
  {
    user: String,
    text: String,
    role: String,
    ai_model: String,
    memory: {
      type: String,
      ref: 'memory',
      index: true,
    },
    is_voice: {
      type: Boolean,
      default: false,
    },
    duration: {
      type: Number,
      default: 0,
    },
    voice_session_id: {type: String, default: undefined},
    voice_turn_index: {type: Number, default: undefined},
    voice_interrupted: {type: Boolean, default: undefined},
    raw_text: {type: String, default: undefined},
    voice_cleaned: {type: Boolean, default: undefined},
    attatchments: [
      {
        type: String,
        ref: 'file',
      },
    ],
    replyTo: {
      type: {
        role: String,
        text: String,
      },
      default: undefined,
    },
  },
  {
    timestamps: {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
);

message.index(
  {memory: 1, voice_session_id: 1, voice_turn_index: 1},
  {
    unique: true,
    partialFilterExpression: {voice_session_id: {$type: 'string'}},
    name: 'voice_turn_unique',
  },
);

message.index(
  {user: 1, voice_session_id: 1},
  {
    partialFilterExpression: {voice_session_id: {$type: 'string'}},
    name: 'voice_session_by_user',
  },
);

message.plugin(mongoosePaginate);

const Message = model<IMessage, PaginateModel<IMessage>>('message', message);
export default Message;
