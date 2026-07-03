import {model, Schema} from 'mongoose';

export type FeatureScopeType = 'global' | 'environment' | 'user';

export interface IFeatureDefinition {
  key: string;
  domain: string;
  description?: string;
  owner?: string;
  tags?: string[];
  default_value: boolean;
  created_at?: Date;
  updated_at?: Date;
}

export interface IFeatureOverride {
  key: string;
  scope_type: FeatureScopeType;
  scope_id: string;
  value: boolean;
  rollout_percentage?: number | null;
  reason?: string;
  updated_by?: string;
  created_at?: Date;
  updated_at?: Date;
}

const featureDefinition = new Schema<IFeatureDefinition>(
  {
    key: {type: String, required: true, unique: true, index: true},
    domain: {type: String, required: true, index: true},
    description: String,
    owner: String,
    tags: [String],
    default_value: {type: Boolean, default: true},
  },
  {
    timestamps: {createdAt: 'created_at', updatedAt: 'updated_at'},
  },
);

const featureOverride = new Schema<IFeatureOverride>(
  {
    key: {type: String, required: true, index: true},
    scope_type: {
      type: String,
      required: true,
      enum: ['global', 'environment', 'user'],
      index: true,
    },
    scope_id: {type: String, required: true, index: true},
    value: {type: Boolean, required: true},
    rollout_percentage: {type: Number, min: 0, max: 100, default: null},
    reason: String,
    updated_by: String,
  },
  {
    timestamps: {createdAt: 'created_at', updatedAt: 'updated_at'},
  },
);

featureOverride.index({key: 1, scope_type: 1, scope_id: 1}, {unique: true});

export const FeatureDefinition = model<IFeatureDefinition>(
  'feature_definition',
  featureDefinition,
);
export const FeatureOverride = model<IFeatureOverride>(
  'feature_override',
  featureOverride,
);
