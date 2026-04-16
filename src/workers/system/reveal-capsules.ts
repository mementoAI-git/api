import dayjs from 'dayjs';
import Capsule from '../../module/database/model/capsule';
import mail from '../../module/mail';
import {
  scheduleCapsuleDelivery,
  systemQueue,
} from '../../services/queues/system';
import {FRONTEND_URL} from '../../utils/config';
import logger from '../../utils/logger';
import {concatStrings} from '../../utils';
import {IUser} from '../../module/database/model/user';
import {IBeneficiary} from '../../module/database/model/beneficiary';

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

  console.log(capsule);
  if (!capsule) {
    logger.warn({capsuleId}, 'Capsule not found for reveal');
    return;
  }

  if (capsule.status !== 'scheduled') {
    logger.debug(
      {capsuleId, status: capsule.status},
      'Capsule already processed',
    );
    return;
  }

  try {
    const benefactor = capsule.user as IUser;
    const benefactorName =
      benefactor?.fullname ||
      concatStrings(
        benefactor?.first_name,
        benefactor?.last_name,
        ' ',
      ).trim() ||
      'Someone';

    const benefactorUserId = benefactor?._id;

    const attachmentIds = capsule.attachments || [];
    const memoryIds = capsule.memories || [];

    const recipients = capsule.recipients as unknown as IBeneficiary[];
    for (const recipient of recipients) {
      const recipientUserId = recipient.user ? String(recipient.user) : null;
      if (!recipientUserId) {
        logger.debug(
          {email: recipient.email},
          'Skipping recipient without user (invite not accepted)',
        );
        continue;
      }

      const created = await Capsule.create({
        user: recipientUserId,
        benefactor: benefactorUserId,
        source: capsuleId,
        status: 'received',
        title: capsule.title,
        body: capsule.body,
        attachments: attachmentIds,
        memories: memoryIds,
        recipients: [], // received capsules have no recipients
      });

      const url = `${FRONTEND_URL}/timecapsule/${created._id}`;
      await mail.sendCapsuleReveal({
        email: recipient.email,
        name: recipient.name || '',
        url,
        benefactorName,
      });
    }

    await Capsule.findByIdAndUpdate(capsuleId, {status: 'delivered'});
    logger.info({capsuleId}, 'Capsule revealed and delivered successfully');
  } catch (error) {
    logger.error({error, capsuleId}, 'Failed to reveal capsule');
    await Capsule.findByIdAndUpdate(capsuleId, {status: 'failed'});
    throw error;
  }
}
