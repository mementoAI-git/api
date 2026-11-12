import {model, Schema} from 'mongoose';

export interface IArchiveExport {
  user_id: string;
  status: 'pending' | 'processing' | 'complete' | 'failed' | 'expired';
  object_key?: string | null;
  progress: {
    stories_total: number;
    stories_exported: number;
    capsules_total: number;
    capsules_exported: number;
    attachments_total: number;
    attachments_exported: number;
  };
  warnings: string[];
  error?: string | null;
  expires_at: Date;
  /** Email the download link to the owner when the archive is ready (account deletion). */
  email_on_complete?: boolean;
  created_at?: Date;
  updated_at?: Date;
}

const progressSchema = new Schema(
  {
    stories_total: {type: Number, default: 0},
    stories_exported: {type: Number, default: 0},
    capsules_total: {type: Number, default: 0},
    capsules_exported: {type: Number, default: 0},
    attachments_total: {type: Number, default: 0},
    attachments_exported: {type: Number, default: 0},
  },
  {_id: false},
);

const schema = new Schema<IArchiveExport>(
  {
    user_id: {type: String, required: true, index: true},
    status: {
      type: String,
      required: true,
      enum: ['pending', 'processing', 'complete', 'failed', 'expired'],
      default: 'pending',
      index: true,
    },
    object_key: {type: String, default: null, select: false},
    progress: {type: progressSchema, default: () => ({})},
    warnings: {type: [String], default: []},
    error: {type: String, default: null},
    expires_at: {type: Date, required: true, index: true},
    email_on_complete: {type: Boolean, default: false},
  },
  {timestamps: {createdAt: 'created_at', updatedAt: 'updated_at'}},
);

schema.index({user_id: 1, created_at: -1});

const ArchiveExport = model<IArchiveExport>('archive_export', schema);
export default ArchiveExport;
