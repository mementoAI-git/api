import type {ClientSession} from 'mongoose';
import Beneficiary from '../../database/model/beneficiary';
import Capsule from '../../database/model/capsule';
import Subscription from '../../database/model/subscription';
import Usage, {type IUsage} from '../../database/model/usage';
import {resolveEffectiveTier, throwSubscriptionRequired} from './access';

export type CountedUsageKey =
  | 'beneficiary_count'
  | 'timed_message_count'
  | 'time_capsule_count'
  | 'memory_integration_count';

async function ensureUsageDocument(
  userId: string,
  session?: ClientSession,
): Promise<void> {
  await Usage.updateOne(
    {user_id: userId},
    {$setOnInsert: {user_id: userId}},
    {upsert: true, session},
  );
}

export async function acquireUsageSlot(
  userId: string,
  counter: CountedUsageKey,
  freeLimit: number,
  feature: 'beneficiaries' | 'timed_messages',
  session?: ClientSession,
): Promise<void> {
  await ensureUsageDocument(userId, session);
  const subscription = await Subscription.findOne({user_id: userId})
    .session(session ?? null)
    .lean();
  const paid = ['pro', 'legacy'].includes(resolveEffectiveTier(subscription));
  const filter = paid
    ? {user_id: userId}
    : {
        user_id: userId,
        $expr: {$lt: [{$ifNull: [`$${counter}`, 0]}, freeLimit]},
      };
  const updated = await Usage.findOneAndUpdate(
    filter,
    {$inc: {[counter]: 1}, $set: {last_updated: new Date()}},
    {new: true, session},
  );
  if (!updated) throwSubscriptionRequired(feature);
}

export async function applyUsageDelta(
  userId: string,
  counter: CountedUsageKey,
  delta: number,
  session?: ClientSession,
): Promise<void> {
  if (!delta) return;
  await ensureUsageDocument(userId, session);
  await Usage.updateOne(
    {user_id: userId},
    [
      {
        $set: {
          [counter]: {
            $max: [0, {$add: [{$ifNull: [`$${counter}`, 0]}, delta]}],
          },
          last_updated: '$$NOW',
        },
      },
    ],
    {session},
  );
}

export async function reconcileUsageCounts(userId: string): Promise<boolean> {
  const [beneficiaryCount, timedMessageCount, timeCapsuleCount, current] =
    await Promise.all([
      Beneficiary.countDocuments({benefactor: userId}),
      Capsule.countDocuments({user: userId, status: 'scheduled'}),
      Capsule.countDocuments({user: userId, status: {$ne: 'received'}}),
      Usage.findOne({user_id: userId})
        .select('beneficiary_count timed_message_count time_capsule_count')
        .lean(),
    ]);
  const drifted =
    !current ||
    current.beneficiary_count !== beneficiaryCount ||
    current.timed_message_count !== timedMessageCount ||
    current.time_capsule_count !== timeCapsuleCount;
  await Usage.findOneAndUpdate(
    {user_id: userId},
    {
      $set: {
        beneficiary_count: beneficiaryCount,
        timed_message_count: timedMessageCount,
        time_capsule_count: timeCapsuleCount,
        last_updated: new Date(),
      },
      $setOnInsert: {user_id: userId},
    },
    {upsert: true},
  );
  return drifted;
}

export function usageCountPatch(
  usage: Pick<IUsage, CountedUsageKey>,
): Pick<IUsage, CountedUsageKey> {
  return {
    beneficiary_count: usage.beneficiary_count || 0,
    timed_message_count: usage.timed_message_count || 0,
    time_capsule_count: usage.time_capsule_count || 0,
    memory_integration_count: usage.memory_integration_count || 0,
  };
}
