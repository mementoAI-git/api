import {model, Schema} from 'mongoose';

export interface IAppliedMigration {
  id: string;
  status: 'running' | 'applied' | 'failed';
  owner?: string;
  lease_expires_at?: Date;
  applied_at?: Date;
  failed_at?: Date;
  error?: string;
}

const migrationSchema = new Schema<IAppliedMigration>(
  {
    id: {type: String, required: true},
    status: {
      type: String,
      enum: ['running', 'applied', 'failed'],
      default: 'running',
    },
    owner: String,
    lease_expires_at: Date,
    applied_at: Date,
    failed_at: Date,
    error: String,
  },
  {versionKey: false},
);

migrationSchema.index({id: 1}, {name: 'migration_id_unique', unique: true});

const Migration = model<IAppliedMigration>('migration', migrationSchema);
export default Migration;
