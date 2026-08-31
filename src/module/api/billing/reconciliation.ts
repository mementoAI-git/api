import User from '../../database/model/user';
import {reconcileStorageUsage} from './storage-quota';
import {reconcileUsageCounts} from './usage-accounting';
import {recordAiMetric} from '../../../services/ai/metrics';

export async function reconcileBillingUsageBatch(
  limit = 500,
  afterId?: string,
) {
  const boundedLimit = Math.min(1000, Math.max(1, Math.floor(limit)));
  const users = await User.find({
    deleted: {$ne: true},
    ...(afterId && {_id: {$gt: afterId}}),
  })
    .select('_id')
    .sort({_id: 1})
    .limit(boundedLimit + 1)
    .lean();
  const batch = users.slice(0, boundedLimit);
  let drifted = 0;

  for (const user of batch) {
    const userId = String(user._id);
    const results = await Promise.all([
      reconcileStorageUsage(userId),
      reconcileUsageCounts(userId),
    ]);
    if (results.some(Boolean)) drifted++;
  }

  return {
    processed: batch.length,
    drifted,
    has_more: users.length > boundedLimit,
    next_cursor: batch.length ? String(batch[batch.length - 1]._id) : null,
  };
}

export async function reconcileAllBillingUsage(): Promise<number> {
  let cursor: string | undefined;
  let processed = 0;
  let drifted = 0;
  let hasMore = false;
  do {
    const page = await reconcileBillingUsageBatch(500, cursor);
    processed += page.processed;
    drifted += page.drifted;
    hasMore = page.has_more;
    cursor = page.has_more && page.next_cursor ? page.next_cursor : undefined;
  } while (hasMore && cursor);
  await recordAiMetric({
    event: 'billing.usage_reconciliation',
    metadata: {processed, drifted},
  });
  return processed;
}
