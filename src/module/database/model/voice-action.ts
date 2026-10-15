import {model, Schema} from 'mongoose';

/**
 * What Memento did for the host by voice, so "undo that" can reverse it and
 * a tool call Gemini repeats (after a reconnect) runs only once. Kept a week,
 * then removed by a TTL index; deleted with the account.
 */
export interface IVoiceAction {
  _id?: string;
  user: string;
  tool: string;
  /** Gemini's id for the tool call, when the app sends it. */
  call_id?: string;
  /** Set while the call runs, so a repeat waits for the first one. */
  running: boolean;
  /** What the host heard and the app applied. */
  outcome?: {result: string; effects: unknown[]};
  /** How to reverse it; absent when it cannot be undone or did nothing. */
  undo?: Record<string, unknown>;
  /** "renamed "Lagos" to "Beach day"", for "I undid …". */
  summary?: string;
  undone_at?: Date;
  created_at: Date;
  updated_at: Date;
}

const voiceActionSchema = new Schema<IVoiceAction>(
  {
    user: {type: String, ref: 'user', required: true},
    tool: {type: String, required: true},
    call_id: {type: String, default: undefined},
    running: {type: Boolean, default: false},
    outcome: {type: Schema.Types.Mixed, default: undefined},
    undo: {type: Schema.Types.Mixed, default: undefined},
    summary: {type: String, default: undefined},
    undone_at: {type: Date, default: undefined},
  },
  {
    timestamps: {createdAt: 'created_at', updatedAt: 'updated_at'},
    collection: 'voice_actions',
  },
);

export const VOICE_ACTION_TTL_SECONDS = 7 * 24 * 60 * 60;

voiceActionSchema.index({user: 1, created_at: -1}, {name: 'voice_action_user'});
voiceActionSchema.index(
  {user: 1, call_id: 1},
  {
    unique: true,
    name: 'voice_action_call_unique',
    partialFilterExpression: {call_id: {$type: 'string'}},
  },
);
voiceActionSchema.index(
  {created_at: 1},
  {name: 'voice_action_ttl', expireAfterSeconds: VOICE_ACTION_TTL_SECONDS},
);

const VoiceAction = model<IVoiceAction>('voice_action', voiceActionSchema);
export default VoiceAction;
