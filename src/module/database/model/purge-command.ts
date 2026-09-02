import {model, Schema} from 'mongoose';

export type PurgeCommandStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface IPurgeCommand {
  _id?: unknown;
  user_id: string;
  email: string | null;
  schema_version: number;
  status: PurgeCommandStatus;
  attempts: number;
  available_at: Date;
  started_at?: Date | null;
  completed_at?: Date | null;
  last_error_code?: string | null;
  created_at: Date;
  updated_at: Date;
}

const purgeCommandSchema = new Schema<IPurgeCommand>(
  {
    user_id: {type: String, required: true, unique: true, index: true},
    email: {type: String, default: null},
    schema_version: {type: Number, required: true, default: 1},
    status: {
      type: String,
      enum: ['pending', 'running', 'completed', 'failed'],
      default: 'pending',
      index: true,
    },
    attempts: {type: Number, default: 0},
    available_at: {type: Date, default: Date.now, index: true},
    started_at: {type: Date, default: null},
    completed_at: {type: Date, default: null},
    last_error_code: {type: String, default: null},
  },
  {timestamps: {createdAt: 'created_at', updatedAt: 'updated_at'}},
);

purgeCommandSchema.index({status: 1, available_at: 1});

const PurgeCommand = model<IPurgeCommand>('purge_command', purgeCommandSchema);
export default PurgeCommand;
