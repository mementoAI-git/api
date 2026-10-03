import 'dotenv/config';
import mongoose from 'mongoose';
import {connectMongodb} from '../connection';
import Prompt from '../model/prompt';
import {ensureExploreIndexes} from '../explore-indexes';
import {LEGACY_EXPLORE_CATEGORY_ALIASES} from '../../api/prompt/explore-taxonomy';
import logger from '../../../utils/logger';

type LegacyExploreCategory = keyof typeof LEGACY_EXPLORE_CATEGORY_ALIASES;

export function buildForwardMigrationUpdate(category: string) {
  const canonical =
    LEGACY_EXPLORE_CATEGORY_ALIASES[category as LegacyExploreCategory];
  if (!canonical) return null;
  return {
    $set: {
      legacy_category: category,
      category: canonical,
      source: 'legacy' as const,
      active: false,
    },
  };
}

export function buildReverseMigrationUpdate(legacyCategory: string) {
  if (!(legacyCategory in LEGACY_EXPLORE_CATEGORY_ALIASES)) return null;
  return {
    $set: {category: legacyCategory, active: true},
    $unset: {legacy_category: '', source: ''},
  };
}

async function categoryCounts(field: 'category' | 'legacy_category') {
  return Prompt.aggregate<{_id: string | null; count: number}>([
    {$group: {_id: `$${field}`, count: {$sum: 1}}},
    {$sort: {count: -1}},
  ]);
}

export async function runExploreTopicsMigration(options: {
  apply: boolean;
  reverse: boolean;
}) {
  const before = await categoryCounts(
    options.reverse ? 'legacy_category' : 'category',
  );
  const operations: Array<{
    category: string;
    matched: number;
    modified: number;
  }> = [];

  if (options.apply && !options.reverse) {
    await ensureExploreIndexes();
  }

  for (const category of Object.keys(
    LEGACY_EXPLORE_CATEGORY_ALIASES,
  ) as LegacyExploreCategory[]) {
    const filter = options.reverse
      ? {legacy_category: category, source: 'legacy'}
      : {category, legacy_category: {$exists: false}};
    const matched = await Prompt.countDocuments(filter);
    let modified = 0;
    if (options.apply && matched > 0) {
      const update = options.reverse
        ? buildReverseMigrationUpdate(category)
        : buildForwardMigrationUpdate(category);
      if (update) {
        const result = await Prompt.updateMany(filter, update);
        modified = result.modifiedCount;
      }
    }
    operations.push({category, matched, modified});
  }

  return {
    mode: options.apply ? 'apply' : 'dry-run',
    direction: options.reverse ? 'reverse' : 'forward',
    indexesEnsured: options.apply && !options.reverse,
    before,
    operations,
    after: options.apply
      ? await categoryCounts(options.reverse ? 'category' : 'legacy_category')
      : null,
  };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const reverse = process.argv.includes('--reverse');
  await connectMongodb();
  const result = await runExploreTopicsMigration({apply, reverse});
  logger.info(result, 'Explore topics migration result');
  await mongoose.disconnect();
}

if (require.main === module) {
  main().catch(async error => {
    logger.error(error, 'Explore topics migration failed');
    await mongoose.disconnect();
    process.exitCode = 1;
  });
}
