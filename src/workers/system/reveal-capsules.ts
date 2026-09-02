import dayjs from 'dayjs';
import Capsule from '../../module/database/model/capsule';
import {
  scheduleCapsuleDelivery,
  systemQueue,
} from '../../services/queues/system';
import logger from '../../utils/logger';
import {concatStrings} from '../../utils';
import {IUser} from '../../module/database/model/user';
import {normalizeCapsuleRecipients} from '../../module/api/capsule/recipients';
import {deliverCapsuleRecipient} from '../../module/api/capsule/capsule-delivery';
import {applyUsageDelta} from '../../module/api/billing/usage-accounting';
import mongoose from 'mongoose';

export async function finalizeCapsuleDelivery(
  capsuleId: string,
  userId: string,
  status: 'delivered' | 'failed',
): Promise<boolean> {
  const session = await mongoose.startSession();
  try {
    let finalized = false;
    await session.withTransaction(async () => {
      const previous = await Capsule.findOneAndUpdate(
        {_id: capsuleId, status: {$in: ['scheduled', 'failed']}},
        {$set: {status}},
        {session},
      );
      if (!previous) return;

      finalized = true;
      if (previous.status === 'scheduled') {
        await applyUsageDelta(userId, 'timed_message_count', -1, session);
      }
    });
    return finalized;
  } finally {
    await session.endSession();
  }
}

/**
 * Handler for scheduleCapsuleReveals job (runs daily at midnight).
 * Finds today's scheduled capsules and enqueues revealCapsules jobs with delay
 * so each runs at the capsule's exact schedule_date time.
 */
export async function scheduleCapsuleReveals(): Promise<void> {
  if (!systemQueue) {
    logger.error('System queue not available for scheduleCapsuleReveals');
    return;
  }

  const endOfToday = dayjs().endOf('day').toDate();

  // Capsules scheduled for today + overdue (schedule_date < startOfToday)
  const capsules = await Capsule.find({
    status: 'scheduled',
    schedule_date: {$lte: endOfToday},
  }).lean();

  for (const capsule of capsules) {
    await scheduleCapsuleDelivery(
      capsule._id.toString(),
      capsule.schedule_date,
    );
  }

  logger.debug(`Scheduled ${capsules.length} capsule(s) for reveal`);
}

/**
 * Handler for revealCapsules job.
 * Creates CapsuleReveal, sends emails to recipients, updates capsule status.
 */
export async function revealCapsules(job: {
  data: {capsuleId: string};
}): Promise<void> {
  const {capsuleId} = job.data;

  const capsule = await Capsule.findById(capsuleId)
    .populate('user', 'first_name last_name fullname _id')
    .populate('recipients', 'email name user');

  if (!capsule) {
    logger.warn({capsuleId}, 'Capsule not found for reveal');
    return;
  }

  if (!['scheduled', 'failed'].includes(capsule.status)) {
    logger.debug(
      {capsuleId, status: capsule.status},
      'Capsule already processed',
    );
    return;
  }

  const benefactor = capsule.user as IUser;
  const benefactorName =
    benefactor?.fullname ||
    concatStrings(benefactor?.first_name, benefactor?.last_name, ' ').trim() ||
    'Someone';

  if (!capsule.recipient_snapshots?.length && capsule.recipients.length) {
    const legacyIds = capsule.recipients.map(recipient =>
      typeof recipient === 'string'
        ? recipient
        : String((recipient as unknown as {_id: unknown})._id),
    );
    const normalized = await normalizeCapsuleRecipients(
      legacyIds,
      String(benefactor?._id),
    );
    capsule.recipient_snapshots = normalized.snapshots;
    capsule.recipients_snapshot_version = 1;
    capsule.recipients = normalized.legacyIds;
    await capsule.save();
  }

  const results = await Promise.all(
    (capsule.recipient_snapshots || []).map(recipient =>
      deliverCapsuleRecipient(capsuleId, recipient, benefactorName),
    ),
  );
  if (results.some(result => result === null)) {
    logger.debug({capsuleId}, 'Capsule delivery is already being processed');
    return;
  }
  const complete = results.length > 0 && results.every(Boolean);
  await finalizeCapsuleDelivery(
    capsuleId,
    String((benefactor as IUser & {_id?: unknown})?._id),
    complete ? 'delivered' : 'failed',
  );
  if (!complete) {
    logger.warn(
      {capsuleId},
      'Capsule delivery has retryable recipient failures',
    );
    throw new Error('Capsule delivery incomplete');
  }
  logger.info({capsuleId}, 'Capsule revealed and delivered successfully');
}
