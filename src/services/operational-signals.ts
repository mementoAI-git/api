import mongoose from '../module/database/connection';
import CapsuleDelivery from '../module/database/model/capsule-delivery';
import PurgeCommand from '../module/database/model/purge-command';
import Usage from '../module/database/model/usage';
import AiMetric from '../module/database/model/ai-metric';
import {insightQueue} from './queues/insights';
import {quickCaptureQueue} from './queues/quick-capture';
import {summarizationQueue} from './queues/summarization';
import {systemQueue} from './queues/system';

type QueueLike = {
  getJobCounts(...types: string[]): Promise<Record<string, number>>;
};

type NullableMetric = number | null;

export type OperationalSignals = {
  collected_at: string;
  queue_depth: NullableMetric;
  queue_failed_jobs: NullableMetric;
  delivery_failures: NullableMetric;
  purge_oldest_age_seconds: NullableMetric;
  usage_stale_records: NullableMetric;
  usage_drift_records: NullableMetric;
  compatibility_events_24h: NullableMetric;
};

async function queueCounts(
  queues: Array<QueueLike | null>,
): Promise<{depth: NullableMetric; failed: NullableMetric}> {
  const results = await Promise.all(
    queues
      .filter((queue): queue is QueueLike => queue !== null)
      .map(queue =>
        queue.getJobCounts('waiting', 'active', 'delayed', 'failed'),
      ),
  );

  if (results.length === 0) return {depth: null, failed: null};
  return results.reduce<{depth: NullableMetric; failed: NullableMetric}>(
    (total, counts) => ({
      depth:
        (total.depth ?? 0) +
        (counts.waiting || 0) +
        (counts.active || 0) +
        (counts.delayed || 0),
      failed: (total.failed ?? 0) + (counts.failed || 0),
    }),
    {depth: 0, failed: 0},
  );
}

export async function collectOperationalSignals(): Promise<OperationalSignals> {
  const [queues, database] = await Promise.all([
    queueCounts([
      summarizationQueue,
      insightQueue,
      quickCaptureQueue,
      systemQueue,
    ]).catch(() => ({depth: null, failed: null})),
    collectDatabaseSignals(),
  ]);

  return {
    collected_at: new Date().toISOString(),
    queue_depth: queues.depth,
    queue_failed_jobs: queues.failed,
    ...database,
  };
}

async function collectDatabaseSignals(): Promise<
  Pick<
    OperationalSignals,
    | 'delivery_failures'
    | 'purge_oldest_age_seconds'
    | 'usage_stale_records'
    | 'usage_drift_records'
    | 'compatibility_events_24h'
  >
> {
  if (mongoose.connection.readyState !== 1) {
    return {
      delivery_failures: null,
      purge_oldest_age_seconds: null,
      usage_stale_records: null,
      usage_drift_records: null,
      compatibility_events_24h: null,
    };
  }

  try {
    const now = Date.now();
    const staleUsageCutoff = new Date(now - 26 * 60 * 60 * 1000);
    const compatibilityCutoff = new Date(now - 24 * 60 * 60 * 1000);
    const [
      deliveryFailures,
      oldestPurge,
      staleUsage,
      latestUsageReconciliation,
      compatibilityEvents,
    ] = await Promise.all([
      CapsuleDelivery.countDocuments({status: 'failed'}),
      PurgeCommand.findOne({
        available_at: {$lte: new Date(now)},
        $or: [
          {status: {$in: ['pending', 'failed']}},
          {
            status: 'running',
            started_at: {$lte: new Date(now - 15 * 60 * 1000)},
          },
        ],
      })
        .sort({created_at: 1})
        .select('created_at')
        .lean(),
      Usage.countDocuments({last_updated: {$lt: staleUsageCutoff}}),
      AiMetric.findOne({event: 'billing.usage_reconciliation'})
        .sort({created_at: -1})
        .select('metadata')
        .lean(),
      AiMetric.countDocuments({
        event: {$regex: '^compat\\.'},
        created_at: {$gte: compatibilityCutoff},
      }),
    ]);

    return {
      delivery_failures: deliveryFailures,
      purge_oldest_age_seconds: oldestPurge?.created_at
        ? Math.max(
            0,
            Math.floor((now - oldestPurge.created_at.getTime()) / 1000),
          )
        : 0,
      usage_stale_records: staleUsage,
      usage_drift_records:
        typeof latestUsageReconciliation?.metadata?.drifted === 'number'
          ? latestUsageReconciliation.metadata.drifted
          : null,
      compatibility_events_24h: compatibilityEvents,
    };
  } catch {
    return {
      delivery_failures: null,
      purge_oldest_age_seconds: null,
      usage_stale_records: null,
      usage_drift_records: null,
      compatibility_events_24h: null,
    };
  }
}
