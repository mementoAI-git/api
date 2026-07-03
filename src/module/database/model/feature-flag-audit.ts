import {model, Schema} from 'mongoose';
import {FeatureScopeType} from './feature-flag';

export interface IFeatureFlagAudit {
  key: string;
  action: string;
  scope_type: FeatureScopeType;
  scope_id: string;
  old_value?: boolean | null;
  new_value?: boolean | null;
  reason?: string;
  actor?: string;
  payload?: Record<string, unknown>;
  created_at?: Date;
  updated_at?: Date;
}

const featureFlagAudit = new Schema<IFeatureFlagAudit>(
  {
    key: {type: String, required: true, index: true},
    action: {type: String, required: true},
    scope_type: {
      type: String,
      required: true,
      enum: ['global', 'environment', 'user'],
      index: true,
    },
    scope_id: {type: String, required: true, index: true},
    old_value: {type: Boolean, default: null},
    new_value: {type: Boolean, default: null},
    reason: String,
    actor: {type: String, index: true},
    payload: {type: Schema.Types.Mixed, default: {}},
  },
  {
    timestamps: {createdAt: 'created_at', updatedAt: 'updated_at'},
  },
);

export const FeatureFlagAudit = model<IFeatureFlagAudit>(
  'feature_flag_audit',
  featureFlagAudit,
);
