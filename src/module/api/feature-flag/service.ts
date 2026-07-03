import {
  FeatureDefinition,
  FeatureOverride,
  FeatureScopeType,
  IFeatureOverride,
} from '../../database/model/feature-flag';
import {FeatureFlagAudit} from '../../database/model/feature-flag-audit';
import {
  BadRequestException,
  NotFoundException,
} from '../../../utils/service-error';
import {FEATURE_FLAG_ENVIRONMENT} from '../../../utils/config';
import {FEATURE_FLAG_KEYS} from '../../../utils/feature-flag-keys';

interface FeatureContext {
  userId?: string;
  environment?: string;
}

function keyToDomain(key: string) {
  return key.split('.')[0] || 'misc';
}

function hashToPercent(input: string) {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) % 1000;
  }
  return hash % 100;
}

function shouldApplyRollout(
  override: IFeatureOverride,
  context: FeatureContext,
): boolean {
  if (
    override.rollout_percentage === null ||
    override.rollout_percentage === undefined
  ) {
    return true;
  }
  if (!context.userId) return false;
  return (
    hashToPercent(`${override.key}:${context.userId}`) <
    override.rollout_percentage
  );
}

export async function seedFeatureDefinitions() {
  const existing = await FeatureDefinition.find({}, {key: 1}).lean();
  const existingSet = new Set(existing.map(item => item.key));
  const missing = FEATURE_FLAG_KEYS.filter(key => !existingSet.has(key));
  if (missing.length === 0) return;

  await FeatureDefinition.insertMany(
    missing.map(key => ({
      key,
      domain: keyToDomain(key),
      default_value: true,
      tags: [keyToDomain(key)],
    })),
  );
}

export async function listFeatureFlags(payload: {
  page?: number;
  limit?: number;
  search?: string;
  domain?: string;
}) {
  await seedFeatureDefinitions();
  const page = Math.max(1, Number(payload.page || 1));
  const limit = Math.min(200, Math.max(1, Number(payload.limit || 25)));
  const query: Record<string, unknown> = {};
  if (payload.search) {
    const regex = new RegExp(payload.search, 'i');
    query.$or = [{key: regex}, {description: regex}];
  }
  if (payload.domain) query.domain = payload.domain;

  const [items, total] = await Promise.all([
    FeatureDefinition.find(query)
      .sort({key: 1})
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    FeatureDefinition.countDocuments(query),
  ]);

  const keys = items.map(item => item.key);
  const overrides = await FeatureOverride.find({key: {$in: keys}}).lean();
  const grouped = new Map<string, IFeatureOverride[]>();
  overrides.forEach(override => {
    const list = grouped.get(override.key) || [];
    list.push(override);
    grouped.set(override.key, list);
  });

  const data = items.map(item => {
    const list = grouped.get(item.key) || [];
    const global = list.find(
      v => v.scope_type === 'global' && v.scope_id === 'global',
    );
    return {
      key: item.key,
      domain: item.domain,
      description: item.description || '',
      defaultValue: item.default_value,
      effectiveValue: global ? global.value : item.default_value,
      hasOverrides: list.length > 0,
      updatedAt: item.updated_at,
    };
  });

  return {
    message: 'Feature flags fetched',
    data: {docs: data, total, page, limit},
  };
}

export async function getFeatureFlagDetail(key: string) {
  await seedFeatureDefinitions();
  const definition = await FeatureDefinition.findOne({key}).lean();
  if (!definition) throw new NotFoundException('Feature flag not found');
  const overrides = await FeatureOverride.find({key}).lean();
  const [global, environment] = [
    overrides.find(v => v.scope_type === 'global' && v.scope_id === 'global'),
    overrides.find(
      v =>
        v.scope_type === 'environment' &&
        v.scope_id === FEATURE_FLAG_ENVIRONMENT,
    ),
  ];
  const effectiveValue =
    environment?.value ?? global?.value ?? definition.default_value;

  return {
    message: 'Feature flag detail fetched',
    data: {definition, overrides, effectiveValue},
  };
}

export async function evaluateFeatureFlag(
  key: string,
  context: FeatureContext,
) {
  const definition = await FeatureDefinition.findOne({key}).lean();
  if (!definition) return {enabled: true, source: 'missing_default_true'};
  const environment = context.environment || FEATURE_FLAG_ENVIRONMENT;
  const overrides = await FeatureOverride.find({key}).lean();

  const user = context.userId
    ? overrides.find(
        v =>
          v.scope_type === 'user' &&
          v.scope_id === context.userId &&
          shouldApplyRollout(v, context),
      )
    : null;
  if (user) return {enabled: user.value, source: 'user'};

  const env = overrides.find(
    v =>
      v.scope_type === 'environment' &&
      v.scope_id === environment &&
      shouldApplyRollout(v, context),
  );
  if (env) return {enabled: env.value, source: 'environment'};

  const global = overrides.find(
    v =>
      v.scope_type === 'global' &&
      v.scope_id === 'global' &&
      shouldApplyRollout(v, context),
  );
  if (global) return {enabled: global.value, source: 'global'};
  return {enabled: definition.default_value, source: 'default'};
}

async function writeAudit(input: {
  key: string;
  action: string;
  scope_type: FeatureScopeType;
  scope_id: string;
  old_value?: boolean | null;
  new_value?: boolean | null;
  reason?: string;
  actor?: string;
  payload?: Record<string, unknown>;
}) {
  await FeatureFlagAudit.create(input);
}

export async function updateDefaultValue(payload: {
  key: string;
  value: boolean;
  actor?: string;
  reason?: string;
}) {
  await seedFeatureDefinitions();
  const current = await FeatureDefinition.findOne({key: payload.key});
  if (!current) throw new NotFoundException('Feature flag not found');
  const old = current.default_value;
  current.default_value = payload.value;
  await current.save();
  await writeAudit({
    key: payload.key,
    action: 'default_update',
    scope_type: 'global',
    scope_id: 'default',
    old_value: old,
    new_value: payload.value,
    reason: payload.reason,
    actor: payload.actor,
  });
  return {message: 'Default value updated', data: current};
}

export async function upsertOverride(payload: {
  key: string;
  scopeType: FeatureScopeType;
  scopeId: string;
  value: boolean;
  rolloutPercentage?: number | null;
  reason?: string;
  actor?: string;
}) {
  if (
    payload.rolloutPercentage !== undefined &&
    payload.rolloutPercentage !== null &&
    (payload.rolloutPercentage < 0 || payload.rolloutPercentage > 100)
  ) {
    throw new BadRequestException(
      'rolloutPercentage must be between 0 and 100',
    );
  }
  await seedFeatureDefinitions();
  const old = await FeatureOverride.findOne({
    key: payload.key,
    scope_type: payload.scopeType,
    scope_id: payload.scopeId,
  });

  const next = await FeatureOverride.findOneAndUpdate(
    {
      key: payload.key,
      scope_type: payload.scopeType,
      scope_id: payload.scopeId,
    },
    {
      $set: {
        value: payload.value,
        rollout_percentage: payload.rolloutPercentage ?? null,
        reason: payload.reason,
        updated_by: payload.actor,
      },
    },
    {upsert: true, new: true},
  );

  await writeAudit({
    key: payload.key,
    action: old ? 'override_update' : 'override_create',
    scope_type: payload.scopeType,
    scope_id: payload.scopeId,
    old_value: old?.value ?? null,
    new_value: payload.value,
    reason: payload.reason,
    actor: payload.actor,
    payload: {
      old_rollout_percentage: old?.rollout_percentage ?? null,
      rollout_percentage: payload.rolloutPercentage ?? null,
    },
  });

  return {message: 'Feature override saved', data: next};
}

export async function deleteOverride(payload: {
  key: string;
  scopeType: FeatureScopeType;
  scopeId: string;
  actor?: string;
  reason?: string;
}) {
  const old = await FeatureOverride.findOneAndDelete({
    key: payload.key,
    scope_type: payload.scopeType,
    scope_id: payload.scopeId,
  });
  if (!old) throw new NotFoundException('Feature override not found');

  await writeAudit({
    key: payload.key,
    action: 'override_delete',
    scope_type: payload.scopeType,
    scope_id: payload.scopeId,
    old_value: old.value,
    new_value: null,
    reason: payload.reason,
    actor: payload.actor,
    payload: {old_rollout_percentage: old.rollout_percentage ?? null},
  });
  return {message: 'Feature override deleted', data: old};
}

export async function updateRollout(payload: {
  key: string;
  scopeType: FeatureScopeType;
  scopeId: string;
  rolloutPercentage: number | null;
  actor?: string;
  reason?: string;
}) {
  if (
    payload.rolloutPercentage !== null &&
    (payload.rolloutPercentage < 0 || payload.rolloutPercentage > 100)
  ) {
    throw new BadRequestException(
      'rolloutPercentage must be between 0 and 100',
    );
  }
  const current = await FeatureOverride.findOne({
    key: payload.key,
    scope_type: payload.scopeType,
    scope_id: payload.scopeId,
  });
  if (!current) throw new NotFoundException('Feature override not found');
  const old = current.rollout_percentage ?? null;
  current.rollout_percentage = payload.rolloutPercentage;
  current.reason = payload.reason;
  current.updated_by = payload.actor;
  await current.save();

  await writeAudit({
    key: payload.key,
    action: 'rollout_update',
    scope_type: payload.scopeType,
    scope_id: payload.scopeId,
    old_value: current.value,
    new_value: current.value,
    reason: payload.reason,
    actor: payload.actor,
    payload: {
      old_rollout_percentage: old,
      rollout_percentage: payload.rolloutPercentage,
    },
  });
  return {message: 'Rollout updated', data: current};
}

export async function getFlagAudit(key: string, limit = 50) {
  const docs = await FeatureFlagAudit.find({key})
    .sort({created_at: -1})
    .limit(Math.min(200, Math.max(1, limit)))
    .lean();
  return {message: 'Feature flag audit fetched', data: docs};
}

export async function bulkSetByPrefix(payload: {
  prefix: string;
  value: boolean;
  actor?: string;
  reason?: string;
}) {
  await seedFeatureDefinitions();
  const defs = await FeatureDefinition.find({
    key: new RegExp(
      `^${payload.prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
    ),
  }).lean();

  const results = await Promise.all(
    defs.map(item =>
      upsertOverride({
        key: item.key,
        scopeType: 'global',
        scopeId: 'global',
        value: payload.value,
        actor: payload.actor,
        reason: payload.reason,
      }),
    ),
  );
  return {message: 'Bulk update complete', data: {count: results.length}};
}
