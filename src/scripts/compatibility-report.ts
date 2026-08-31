import 'dotenv/config';
import mongoose from 'mongoose';
import AiMetric from '../module/database/model/ai-metric';
import File from '../module/database/model/file';
import User from '../module/database/model/user';
import {connectMongodb} from '../module/database/connection';

const SHIMS = [
  {
    id: 'FILES_LEGACY_BARE_URL',
    event: 'compat.files.legacy_bare_url',
    inventory: 'legacy_public_files' as const,
  },
  {
    id: 'AUTH_LEGACY_RESPONSE',
    event: 'compat.auth.legacy_session_shape',
    exposureOnly: true,
  },
  {
    id: 'AUTH_LEGACY_REFRESH',
    event: 'compat.auth.legacy_refresh',
    inventory: 'users_with_legacy_refresh_tokens' as const,
  },
  {id: 'USERS_PROFILE_POST', event: 'compat.users.profile_post'},
  {
    id: 'PUSH_LEGACY_PROFILE_TOKEN',
    event: 'compat.push.legacy_profile_token',
  },
] as const;

export type SupportedClient = {client: string; version: string};
export type CompatibilityDecision =
  | 'retain'
  | 'client_evidence_required'
  | 'configuration_required'
  | 'approval_required';

type UsageAggregate = {
  _id: {event: string; client: string; version: string; build: string};
  count: number;
  first_seen_at: Date;
  last_seen_at: Date;
};

export async function generateCompatibilityReport(options: {
  now?: Date;
  windowDays: number;
  supportedClients: SupportedClient[];
}) {
  const now = options.now || new Date();
  const cutoff = new Date(
    now.getTime() - options.windowDays * 24 * 60 * 60 * 1000,
  );
  const supported = new Set(
    options.supportedClients.map(item => `${item.client}:${item.version}`),
  );
  const usageRows = await AiMetric.aggregate<UsageAggregate>([
    {
      $match: {
        event: {$in: SHIMS.map(shim => shim.event)},
        created_at: {$gte: cutoff, $lte: now},
      },
    },
    {
      $group: {
        _id: {
          event: '$event',
          client: {$ifNull: ['$metadata.client', 'legacy-unknown']},
          version: {$ifNull: ['$metadata.version', 'unknown']},
          build: {$ifNull: ['$metadata.build', 'unknown']},
        },
        count: {$sum: 1},
        first_seen_at: {$min: '$created_at'},
        last_seen_at: {$max: '$created_at'},
      },
    },
    {$sort: {'_id.event': 1, '_id.client': 1, '_id.version': 1}},
  ]);
  const usage = usageRows.map(row => ({
    event: row._id.event,
    client: row._id.client,
    version: row._id.version,
    build: row._id.build,
    count: row.count,
    first_seen_at: row.first_seen_at,
    last_seen_at: row.last_seen_at,
    supported: supported.has(`${row._id.client}:${row._id.version}`),
  }));
  const [usersWithLegacyRefreshTokens, legacyPublicFiles] = await Promise.all([
    User.countDocuments({
      $or: [
        {refresh_token: {$type: 'string', $ne: ''}},
        {'refresh_tokens.0': {$exists: true}},
      ],
    }),
    File.countDocuments({deleted: {$ne: true}, access_mode: 'legacy_public'}),
  ]);
  const inventory = {
    users_with_legacy_refresh_tokens: usersWithLegacyRefreshTokens,
    legacy_public_files: legacyPublicFiles,
  };
  const shims = SHIMS.map(shim => {
    const observedUses = usage
      .filter(row => row.event === shim.event)
      .reduce((sum, row) => sum + row.count, 0);
    const inventoryCount =
      'inventory' in shim ? inventory[shim.inventory] : undefined;
    let decision: CompatibilityDecision;
    if (options.supportedClients.length === 0) {
      decision = 'configuration_required';
    } else if ('exposureOnly' in shim && shim.exposureOnly) {
      decision = 'client_evidence_required';
    } else if (observedUses > 0 || (inventoryCount || 0) > 0) {
      decision = 'retain';
    } else {
      decision = 'approval_required';
    }
    return {
      id: shim.id,
      event: shim.event,
      observed_uses: observedUses,
      ...(inventoryCount === undefined
        ? {}
        : {inventory_count: inventoryCount}),
      decision,
      removal_approved: false,
    };
  });

  return {
    generated_at: now,
    window: {days: options.windowDays, starts_at: cutoff, ends_at: now},
    supported_clients: options.supportedClients,
    inventory,
    usage,
    shims,
    note: 'This read-only report never approves removal; product and platform owners must record separate approval after client evidence review.',
  };
}

function parseArguments(argv: string[]): {
  windowDays: number;
  supportedClients: SupportedClient[];
} {
  const daysIndex = argv.indexOf('--days');
  const supportedIndex = argv.indexOf('--supported');
  const windowDays = Number(daysIndex >= 0 ? argv[daysIndex + 1] : 30);
  if (!Number.isInteger(windowDays) || windowDays < 1 || windowDays > 365) {
    throw new Error('--days must be an integer between 1 and 365');
  }
  const supportedClients = (supportedIndex >= 0 ? argv[supportedIndex + 1] : '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
    .map(value => {
      const separator = value.indexOf(':');
      if (separator < 1 || separator === value.length - 1) {
        throw new Error('--supported entries must use client:version');
      }
      return {
        client: value.slice(0, separator),
        version: value.slice(separator + 1),
      };
    });
  return {windowDays, supportedClients};
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  await connectMongodb();
  try {
    process.stdout.write(
      `${JSON.stringify(await generateCompatibilityReport(options), null, 2)}\n`,
    );
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  void main().catch(error => {
    process.stderr.write(`${String(error)}\n`);
    process.exitCode = 1;
  });
}
