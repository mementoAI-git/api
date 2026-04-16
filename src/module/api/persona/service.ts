import PendingInsight from '../../database/model/pending-insight';
import Persona from '../../database/model/persona';
import {
  NotFoundException,
  InternalServerErrorException,
} from '../../../utils/service-error';
import {addApprovedMemory} from '../../../services/supermemory';

export async function listPendingInsights(user_id: string) {
  const rows = await PendingInsight.find({user: user_id})
    .sort({created_at: -1})
    .select('memory source field content created_at')
    .lean();

  return {
    data: rows,
    message: 'Pending insights retrieved successfully',
  };
}

export async function approvePendingInsight(
  pendingId: string,
  user_id: string,
) {
  const pending = await PendingInsight.findOne({_id: pendingId, user: user_id});
  if (!pending) {
    throw new NotFoundException('Pending insight not found');
  }

  const now = new Date();

  await Persona.findOneAndUpdate(
    {user: user_id},
    {
      $addToSet: {[pending.field]: pending.content},
      $set: {
        last_array_update: now,
        [`last_update.${pending.field}`]: now,
      },
    },
    {upsert: true},
  );

  try {
    await addApprovedMemory(user_id, pending.content);
  } catch {
    throw new InternalServerErrorException(
      'Insight saved to your profile but could not be synced to memory store. Please try again.',
    );
  }

  await pending.deleteOne();

  return {
    data: null,
    message: 'Insight approved and applied',
  };
}

export async function rejectPendingInsight(pendingId: string, user_id: string) {
  const result = await PendingInsight.deleteOne({
    _id: pendingId,
    user: user_id,
  });

  if (result.deletedCount === 0) {
    throw new NotFoundException('Pending insight not found');
  }

  return {
    data: null,
    message: 'Pending insight rejected',
  };
}
