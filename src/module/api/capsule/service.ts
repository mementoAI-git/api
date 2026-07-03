import dayjs from 'dayjs';
import Beneficiary from '../../database/model/beneficiary';
import Capsule, {ICapsule} from '../../database/model/capsule';
import File from '../../database/model/file';
import Memory from '../../database/model/memory';
import {isEmpty, filterGenerator} from '../../../utils/helpers';
import {IPagination} from '../../../utils/interface';
import {NotFoundException} from '../../../utils/service-error';
import {track} from '../activity/service';
import {scheduleCapsuleDelivery} from '../../../services/queues/system';
import {EXCLUDED_STORAGE_PROVIDER} from '../../../utils/constant';

export async function createCapsule(payload: ICapsule, user_id: string) {
  const users = await Beneficiary.find({
    email: {$in: payload.recipients},
    benefactor: user_id,
  });
  if (isEmpty(users)) {
    throw new NotFoundException('Users not found');
  }

  let attachments: string[] = [];
  if (payload?.attachments && payload.attachments.length > 0) {
    const files = await File.find({
      _id: {$in: payload.attachments},
      user: user_id,
    });
    if (files.length !== payload.attachments.length) {
      throw new NotFoundException('Some attachment files not found');
    }
    attachments = files.map(f => f.id);
  }

  let memories: string[] = [];
  if (payload?.memories && payload.memories.length > 0) {
    const memoryDocs = await Memory.find({
      _id: {$in: payload.memories},
      user: user_id,
    });
    if (memoryDocs.length !== payload.memories.length) {
      throw new NotFoundException('Some memories not found');
    }
    memories = memoryDocs.map(m => m.id);
  }

  const capsule = await Capsule.create({
    ...payload,
    title: payload?.title.trim(),
    body: payload?.body.trim(),
    user: user_id,
    recipients: users.map(u => u.id),
    attachments,
    memories,
    ...(payload?.schedule_date
      ? {
          schedule_date: dayjs(payload.schedule_date).toISOString(),
          status: 'scheduled',
        }
      : {status: 'draft'}),
  });

  if (
    capsule.status === 'scheduled' &&
    dayjs(capsule.schedule_date).isBefore(dayjs().endOf('day'))
  ) {
    await scheduleCapsuleDelivery(capsule.id, capsule.schedule_date);
  }

  await track(
    {
      title: 'Capsule Created',
      description: `Created capsule: "${payload.title}"`,
      type: 'capsule',
      action: 'created',
      reference: capsule.id,
    },
    user_id,
  );

  return {message: 'Capsule created successfully', data: capsule.toObject()};
}

export async function updateCapsule(
  id: string,
  payload: Partial<ICapsule>,
  user_id: string,
) {
  const capsule = await Capsule.findOne({_id: id, user: user_id});
  if (!capsule) {
    throw new NotFoundException('Capsule not found');
  }

  if (payload.recipients && payload.recipients.length > 0) {
    const users = await Beneficiary.find({
      email: {$in: payload.recipients},
      benefactor: user_id,
    });
    if (isEmpty(users)) {
      throw new NotFoundException('Recipients not found');
    }
    payload.recipients = users.map(u => u.id);
  }

  if (!isEmpty(payload.attachments)) {
    const files = await File.find({
      _id: {$in: payload.attachments},
      user: user_id,
    });
    if (files.length !== payload.attachments.length) {
      throw new NotFoundException('Some attachment files not found');
    }
    payload.attachments = files.map(f => f.id);
  }

  let validatedMemories: string[] | undefined;
  if (payload?.memories && payload.memories.length > 0) {
    const memoryDocs = await Memory.find({
      _id: {$in: payload.memories},
      user: user_id,
    });
    if (memoryDocs.length !== payload.memories.length) {
      throw new NotFoundException('Some memories not found');
    }
    validatedMemories = memoryDocs.map(m => m.id);
  }

  if (payload?.schedule_date) {
    payload.schedule_date = dayjs(payload.schedule_date).toISOString();
    if (!payload.status) {
      payload.status = 'scheduled';
    }
  }

  const updateData: Record<string, unknown> = {
    $set: {
      ...(payload.title !== undefined && {title: payload.title}),
      ...(payload.body !== undefined && {body: payload.body}),
      ...(payload.schedule_date !== undefined && {
        schedule_date: payload.schedule_date,
      }),
      ...(payload.status !== undefined && {status: payload.status}),
    },
  };

  if (!isEmpty(payload.attachments)) {
    updateData.$addToSet = {
      ...(updateData.$addToSet as Record<string, unknown>),
      attachments: {$each: payload.attachments},
    };
  }

  if (!isEmpty(validatedMemories)) {
    updateData.$addToSet = {
      ...(updateData.$addToSet as Record<string, unknown>),
      memories: {$each: validatedMemories},
    };
  }

  const updateCapsule = await Capsule.findByIdAndUpdate(id, updateData, {
    new: true,
  });

  await track(
    {
      title: 'Capsule Updated',
      description: `Updated capsule: "${capsule.title}"`,
      type: 'capsule',
      action: 'updated',
      reference: capsule.id,
    },
    user_id,
  );

  return {message: 'Capsule updated successfully', data: updateCapsule};
}

export async function getCapsules(payload: IPagination, user: string) {
  const {page, limit, ...query} = payload;

  const filters = filterGenerator(query, ['title', 'body', 'status']);
  filters.push({user});

  const data = await Capsule.paginate(
    {$and: filters},
    {
      limit,
      page,
      sort: {created_at: -1, updated_at: -1},
      populate: [
        {path: 'recipients', select: 'email first_name last_name'},
        {path: 'benefactor', select: 'first_name last_name fullname'},
        {
          path: 'attachments',
          select: '_id name url',
          match: {provider: {$ne: EXCLUDED_STORAGE_PROVIDER}},
        },
        {
          path: 'memories',
          select: '_id title body tags created_at attachments status',
          populate: {
            path: 'attachments',
            select: '_id name url',
            match: {provider: {$ne: EXCLUDED_STORAGE_PROVIDER}},
          },
        },
      ],
    },
  );

  return {message: 'Time capsules retrieved successfully', data};
}

export async function getCapsule(id: string, user: string) {
  const capsule = await Capsule.findOne({user, _id: id}).populate([
    {path: 'recipients', select: 'email first_name last_name'},
    {path: 'benefactor', select: 'first_name last_name fullname'},
    {
      path: 'attachments',
      select: '-base64',
      match: {provider: {$ne: EXCLUDED_STORAGE_PROVIDER}},
    },
    {
      path: 'memories',
      select: '_id title body tags created_at attachments status',
      populate: {
        path: 'attachments',
        select: '_id name url',
        match: {provider: {$ne: EXCLUDED_STORAGE_PROVIDER}},
      },
    },
  ]);
  if (!capsule) {
    throw new NotFoundException('Capsule not found');
  }

  return {message: 'Time capsule retrieved successfully', data: capsule};
}

export async function deleteCapsule(id: string, user: string) {
  const capsule = await Capsule.findOne({user, _id: id});
  if (!capsule) {
    throw new NotFoundException('Capsule not found');
  }

  await capsule.deleteOne();
  await track(
    {
      title: 'Capsule Deleted',
      description: `Deleted capsule: "${capsule.title}"`,
      type: 'capsule',
      action: 'deleted',
      reference: capsule.id,
    },
    user,
  );

  return {message: 'Time capsule deleted successfully', data: capsule};
}

// export async function getCapsuleStats(user: string) {
//   const [delivered_count, scheduled_count, draft_count, frozen_count] =
//     await Promise.all([
//       Capsule.countDocuments({user, status: 'delivered'}),
//       Capsule.countDocuments({user, status: 'scheduled'}),
//       Capsule.countDocuments({user, status: 'draft'}),
//       Capsule.countDocuments({user, status: 'frozen'}),
//     ]);

//   return {
//     message: 'Capsule statistics retrieved successfully',
//     data: {
//       delivered_count,
//       scheduled_count,
//       draft_count,
//       frozen_count,
//     },
//   };
// }

// Optimise for large collections by using aggregation with $match and $group stages
// 1 db trip instead of 4 separate queries
export async function getCapsuleStats(user: string) {
  const stats = await Capsule.aggregate([
    {
      $match: {
        user,
        status: {$in: ['delivered', 'scheduled', 'draft', 'pause']},
      },
    },
    {$group: {_id: '$status', count: {$sum: 1}}},
  ]);

  const counts = Object.fromEntries(
    stats.map(({_id, count}) => [`${_id}_count`, count]),
  );

  return {
    message: 'Capsule statistics retrieved successfully',
    data: {
      delivered_count: counts.delivered_count ?? 0,
      scheduled_count: counts.scheduled_count ?? 0,
      draft_count: counts.draft_count ?? 0,
      paused_count: counts.pause_count ?? 0,
    },
  };
}
