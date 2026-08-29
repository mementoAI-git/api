import {model, Schema} from 'mongoose';

export interface IPurgeStage {
  command_id: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  attempts: number;
  started_at?: Date | null;
  completed_at?: Date | null;
  last_error_code?: string | null;
  created_at: Date;
  updated_at: Date;
}

const purgeStageSchema = new Schema<IPurgeStage>(
  {
    command_id: {
      type: String,
      ref: 'purge_command',
      required: true,
      index: true,
    },
    name: {type: String, required: true},
    status: {
      type: String,
      enum: ['pending', 'running', 'completed', 'failed'],
      default: 'pending',
    },
    attempts: {type: Number, default: 0},
    started_at: {type: Date, default: null},
    completed_at: {type: Date, default: null},
    last_error_code: {type: String, default: null},
  },
  {timestamps: {createdAt: 'created_at', updatedAt: 'updated_at'}},
);

purgeStageSchema.index({command_id: 1, name: 1}, {unique: true});

const PurgeStage = model<IPurgeStage>('purge_stage', purgeStageSchema);
export default PurgeStage;
