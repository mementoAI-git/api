import {model, Schema} from 'mongoose';

/**
 * How long one voice call has run, for the free plan's monthly voice
 * allowance. A call is keyed by when it started (its call ticket), so every
 * reconnect and the final end report update the same record.
 */
export interface IVoiceUsage {
  user: string;
  /** When the call started, in milliseconds (the time inside its call ticket). */
  call_started_at: number;
  /** The calendar month (UTC) the call counts towards, as YYYY-MM. */
  month: string;
  /** Seconds counted against the month: time connected, less long silences. */
  seconds: number;
  /** When the call connected, from the app's first connected check-in (ms). */
  counted_from?: number;
  /** Seconds of long silence the app reported; never counted. */
  quiet_seconds?: number;
  created_at?: Date;
  updated_at?: Date;
}

const voiceUsageSchema = new Schema<IVoiceUsage>(
  {
    user: {type: String, ref: 'user', required: true},
    call_started_at: {type: Number, required: true},
    month: {type: String, required: true},
    seconds: {type: Number, default: 0},
    counted_from: {type: Number},
    quiet_seconds: {type: Number, default: 0},
  },
  {timestamps: {createdAt: 'created_at', updatedAt: 'updated_at'}},
);

voiceUsageSchema.index({user: 1, call_started_at: 1}, {unique: true});
voiceUsageSchema.index({user: 1, month: 1});

const VoiceUsage = model<IVoiceUsage>('voice_usage', voiceUsageSchema);
export default VoiceUsage;
