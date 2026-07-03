import {model, Schema} from 'mongoose';
import {FREE_STORAGE_LIMIT_BYTES} from '../../../utils/constant';

export interface IUsage {
  user_id: string;
  storage_used_bytes: number;
  storage_limit_bytes: number;
  beneficiary_count: number;
  timed_message_count: number;
  time_capsule_count: number;
  memory_integration_count: number;
  last_updated?: Date;
  created_at?: Date;
  updated_at?: Date;
}

const usage = new Schema<IUsage>(
  {
    user_id: {type: String, required: true, unique: true, index: true},
    storage_used_bytes: {type: Number, default: 0},
    storage_limit_bytes: {type: Number, default: FREE_STORAGE_LIMIT_BYTES},
    beneficiary_count: {type: Number, default: 0},
    timed_message_count: {type: Number, default: 0},
    time_capsule_count: {type: Number, default: 0},
    memory_integration_count: {type: Number, default: 0},
    last_updated: {type: Date, default: () => new Date()},
  },
  {
    timestamps: {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
);

const Usage = model<IUsage>('usage', usage);
export default Usage;
