import User from '../../database/model/user';
import Subscription from '../../database/model/subscription';
import Usage from '../../database/model/usage';
import Memory from '../../database/model/memory';
import File from '../../database/model/file';
import SharedSpace from '../../database/model/shared-space';
import CapsuleDelivery from '../../database/model/capsule-delivery';
import ArchiveExport from '../../database/model/archive-export';
import {resolveEffectiveTier} from '../billing/access';
import {NotFoundException} from '../../../utils/service-error';

const accountFields =
  '_id email first_name last_name verified disabled deleted purge_status onboarding_status created_at last_seen';
const timeout = 5000;
export async function listAccounts(search: string, page: number) {
  // Exact lookup avoids unbounded regex scans and ambiguous support matches.
  const filter = !search
    ? {}
    : /^[a-f\d]{24}$/i.test(search)
      ? {_id: search}
      : {email: search.toLowerCase()};
  const [items, total] = await Promise.all([
    User.find(filter)
      .select(accountFields)
      .sort({_id: -1})
      .skip((page - 1) * 25)
      .limit(25)
      .maxTimeMS(timeout)
      .lean(),
    User.countDocuments(filter).maxTimeMS(timeout),
  ]);
  return {items, total, page, limit: 25};
}
export async function accountDetail(id: string) {
  const account = await User.findById(id)
    .select(accountFields)
    .maxTimeMS(timeout)
    .lean();
  if (!account) throw new NotFoundException('Account not found');
  id = String(account._id);
  const [subscription, usage, memories, files, exports] = await Promise.all([
    Subscription.findOne({user_id: id})
      .select(
        'tier status billing_interval payment_provider currency current_period_end trial_ends_at cancel_at_period_end ended_at promo_expires_at',
      )
      .maxTimeMS(timeout)
      .lean(),
    Usage.findOne({user_id: id})
      .select(
        '-_id storage_used_bytes storage_limit_bytes storage_reserved_bytes last_updated',
      )
      .maxTimeMS(timeout)
      .lean(),
    Memory.countDocuments({
      user: id,
      enrichment_status: 'failed',
      status: {$ne: 'deleted'},
    }).maxTimeMS(timeout),
    File.countDocuments({
      user: id,
      status: 'failed',
      deleted: {$ne: true},
    }).maxTimeMS(timeout),
    ArchiveExport.countDocuments({user_id: id, status: 'failed'}).maxTimeMS(
      timeout,
    ),
  ]);
  return {
    account,
    subscription: subscription
      ? {
          tier: subscription.tier,
          effective_tier: resolveEffectiveTier(subscription),
          status: subscription.status,
          billing_interval: subscription.billing_interval,
          payment_provider: subscription.payment_provider,
          currency: subscription.currency,
          current_period_end: subscription.current_period_end,
          trial_ends_at: subscription.trial_ends_at,
          cancel_at_period_end: subscription.cancel_at_period_end,
        }
      : {tier: null, effective_tier: resolveEffectiveTier(null), status: null},
    usage,
    processing: {
      memory_enrichment_failed: memories,
      files_failed: files,
      exports_failed: exports,
    },
  };
}

export async function operationsSummary() {
  const checks = [
    ['accounts', User.countDocuments({deleted: {$ne: true}})],
    [
      'subscriptions_past_due',
      Subscription.countDocuments({status: 'past_due'}),
    ],
    [
      'subscriptions_paid_records',
      Subscription.countDocuments({tier: {$in: ['pro', 'legacy']}}),
    ],
    [
      'memories_pending',
      Memory.countDocuments({
        enrichment_status: 'pending',
        status: {$ne: 'deleted'},
      }),
    ],
    [
      'memories_failed',
      Memory.countDocuments({
        enrichment_status: 'failed',
        status: {$ne: 'deleted'},
      }),
    ],
    [
      'memories_recoverable',
      // Recovery ships independently; an absent schema is unavailable, not zero.
      Memory.schema.path('delete_after')
        ? Memory.countDocuments({
            status: 'deleted',
            delete_after: {$gt: new Date()},
            purge_requested_at: null,
          })
        : null,
    ],
    [
      'files_processing',
      File.countDocuments({status: 'processing', deleted: {$ne: true}}),
    ],
    [
      'files_failed',
      File.countDocuments({status: 'failed', deleted: {$ne: true}}),
    ],
    ['people_active_spaces', SharedSpace.countDocuments({status: 'active'})],
    ['deliveries_failed', CapsuleDelivery.countDocuments({status: 'failed'})],
    [
      'deliveries_pending',
      CapsuleDelivery.countDocuments({
        status: {$in: ['pending', 'processing']},
      }),
    ],
    ['exports_failed', ArchiveExport.countDocuments({status: 'failed'})],
    [
      'exports_pending',
      ArchiveExport.countDocuments({status: {$in: ['pending', 'processing']}}),
    ],
  ] as const;
  const values = await Promise.allSettled(
    checks.map(([, query]) =>
      query ? query.maxTimeMS(timeout).exec() : Promise.resolve(null),
    ),
  );
  return {
    collected_at: new Date().toISOString(),
    counts: Object.fromEntries(
      checks.map(([key], index) => [
        key,
        values[index].status === 'fulfilled' ? values[index].value : null,
      ]),
    ),
  };
}
