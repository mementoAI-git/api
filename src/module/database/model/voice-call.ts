import {model, Schema} from 'mongoose';

export type VoiceCallCleanupStatus =
  | 'pending'
  | 'running'
  | 'done'
  | 'failed'
  | 'skipped';

export interface IVoiceCallSummary {
  text: string;
  key_points: string[];
  generated_at: Date;
  prompt_version: string;
}

export interface IVoiceCall {
  _id?: string;
  user: string;
  memory?: string;
  session_id: string;
  duration_seconds: number;
  ended_at?: Date;
  cleanup_status: VoiceCallCleanupStatus;
  cleaned_at?: Date;
  /** True when the call ended normally, so clean-up should feed insights. */
  queue_insights: boolean;
  summary?: IVoiceCallSummary;
  created_at: Date;
  updated_at: Date;
}

const voiceCallSchema = new Schema<IVoiceCall>(
  {
    user: {type: String, ref: 'user', required: true},
    memory: {type: String, ref: 'memory', default: undefined},
    session_id: {type: String, required: true},
    duration_seconds: {type: Number, default: 0},
    ended_at: {type: Date, default: undefined},
    cleanup_status: {
      type: String,
      enum: ['pending', 'running', 'done', 'failed', 'skipped'],
      default: 'pending',
    },
    cleaned_at: {type: Date, default: undefined},
    queue_insights: {type: Boolean, default: false},
    summary: {
      type: {
        text: String,
        key_points: [String],
        generated_at: Date,
        prompt_version: String,
      },
      default: undefined,
    },
  },
  {timestamps: {createdAt: 'created_at', updatedAt: 'updated_at'}},
);

voiceCallSchema.index({user: 1, session_id: 1}, {unique: true});

const VoiceCall = model<IVoiceCall>('voice_call', voiceCallSchema);
export default VoiceCall;
