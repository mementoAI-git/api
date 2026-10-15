import dayjs from 'dayjs';
import Capsule, {ICapsule} from '../../database/model/capsule';
import Memory from '../../database/model/memory';
import {filterGenerator} from '../../../utils/helpers';
import {IPagination} from '../../../utils/interface';
import {NotFoundException} from '../../../utils/service-error';
import {BadRequestException} from '../../../utils/service-error';
import {track} from '../activity/service';
import {scheduleCapsuleDelivery} from '../../../services/queues/system';
import {assertOwnedFileIds} from '../file/access';
import {EXCLUDED_STORAGE_PROVIDER} from '../../../utils/constant';
import {normalizeCapsuleRecipients} from './recipients';
import {acquireUsageSlot, applyUsageDelta} from '../billing/usage-accounting';
import mongoose from 'mongoose';
import {forgetUserContext} from '../../../services/user-context-cache';
export {
  exchangeExternalViewToken,
  getExternalCapsule,
} from './capsule-delivery';

type CapsuleMutationPayload = Omit<
  ICapsule,
  'user' | 'created_at' | 'updated_at'
>;

function validateStyle(style: ICapsule['style']): ICapsule['style'] {
  if (!style) return undefined;
  const safeValue = (value: unknown, max = 64) =>
    typeof value === 'string' && value.length <= max ? value : undefined;
  return {
    themeId: safeValue(style.themeId),
    backgroundColor: safeValue(style.backgroundColor),
    fontSize: safeValue(style.fontSize, 24),
    textColor: safeValue(style.textColor),
    headerColor: safeValue(style.headerColor),
  };
}

function assertSchedulable(capsule: {
  title?: string;
  body?: string;
  schedule_date?: string | Date;
  recipient_snapshots?: unknown[];
}): void {
  if (!capsule.title?.trim() || !capsule.body?.trim()) {
    throw new BadRequestException('Title and body are required to schedule');
  }
  if (!capsule.recipient_snapshots?.length) {
    throw new BadRequestException(
      'At least one valid recipient is required to schedule',
    );
  }
  if (
    !capsule.schedule_date ||
    !dayjs(capsule.schedule_date).isAfter(dayjs())
  ) {
    throw new BadRequestException(
      'A valid future reveal date is required to schedule',
    );
  }
}

export async function createCapsule(
  payload: CapsuleMutationPayload,
  user_id: string,
) {
  const {snapshots, legacyIds} = await normalizeCapsuleRecipients(
    payload.recipients || [],
    user_id,
  );

  let attachments: string[] = [];
  if (payload?.attachments && payload.attachments.length > 0) {
    attachments = await assertOwnedFileIds(user_id, payload.attachments);
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

  const status =
    payload.status === 'draft'
      ? 'draft'
      : payload.status === 'scheduled' || payload.schedule_date
        ? 'scheduled'
        : 'draft';
  const candidate = {
    title: payload?.title?.trim() || '',
    body: payload?.body?.trim() || '',
    schedule_date: payload?.schedule_date
      ? dayjs(payload.schedule_date).toISOString()
      : undefined,
    recipient_snapshots: snapshots,
  };
  if (status === 'scheduled') assertSchedulable(candidate);

  let capsule;
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      if (status === 'scheduled') {
        await acquireUsageSlot(
          user_id,
          'timed_message_count',
          5,
          'timed_messages',
          session,
        );
      }
      [capsule] = await Capsule.create(
        [
          {
            title: candidate.title,
            body: candidate.body,
            user: user_id,
            recipients: legacyIds,
            recipient_snapshots: snapshots,
            recipients_snapshot_version: 1,
            attachments,
            memories,
            style: validateStyle(payload.style),
            ...(candidate.schedule_date && {
              schedule_date: candidate.schedule_date,
            }),
            status,
          },
        ],
        {session},
      );
      await applyUsageDelta(user_id, 'time_capsule_count', 1, session);
    });
  } finally {
    await session.endSession();
  }

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

  void forgetUserContext(user_id);
  return {message: 'Capsule created successfully', data: capsule.toObject()};
}

export async function updateCapsule(
  id: string,
  payload: Partial<CapsuleMutationPayload>,
  user_id: string,
) {
  const capsule = await Capsule.findOne({_id: id, user: user_id});
  if (!capsule) {
    throw new NotFoundException('Capsule not found');
  }

  let normalizedRecipients:
    | Awaited<ReturnType<typeof normalizeCapsuleRecipients>>
    | undefined;
  if (payload.recipients !== undefined) {
    normalizedRecipients = await normalizeCapsuleRecipients(
      payload.recipients,
      user_id,
    );
  }
  if (
    payload.status === 'scheduled' &&
    !normalizedRecipients &&
    !capsule.recipient_snapshots?.length &&
    capsule.recipients.length
  ) {
    normalizedRecipients = await normalizeCapsuleRecipients(
      capsule.recipients,
      user_id,
    );
  }

  let validatedAttachments: string[] | undefined;
  if (payload.attachments !== undefined) {
    validatedAttachments = payload.attachments.length
      ? await assertOwnedFileIds(user_id, payload.attachments)
      : [];
  }

  let validatedMemories: string[] | undefined;
  if (payload.memories !== undefined) {
    if (payload.memories.length > 0) {
      const memoryDocs = await Memory.find({
        _id: {$in: payload.memories},
        user: user_id,
      });
      if (memoryDocs.length !== payload.memories.length) {
        throw new NotFoundException('Some memories not found');
      }
      validatedMemories = memoryDocs.map(m => m.id);
    } else {
      validatedMemories = [];
    }
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
      ...(normalizedRecipients && {
        recipients: normalizedRecipients.legacyIds,
        recipient_snapshots: normalizedRecipients.snapshots,
        recipients_snapshot_version: 1,
      }),
      ...(validatedAttachments !== undefined && {
        attachments: validatedAttachments,
      }),
      ...(validatedMemories !== undefined && {memories: validatedMemories}),
      ...(payload.style !== undefined && {style: validateStyle(payload.style)}),
    },
  };

  const merged = {
    title: payload.title ?? capsule.title,
    body: payload.body ?? capsule.body,
    schedule_date: payload.schedule_date ?? capsule.schedule_date,
    recipient_snapshots:
      normalizedRecipients?.snapshots ?? capsule.recipient_snapshots,
  };
  if (payload.status === 'scheduled') assertSchedulable(merged);

  let updateCapsule;
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const current = await Capsule.findOne({_id: id, user: user_id}).session(
        session,
      );
      if (!current) throw new NotFoundException('Capsule not found');
      const nextStatus = payload.status ?? current.status;
      const startsScheduling =
        current.status !== 'scheduled' && nextStatus === 'scheduled';
      if (startsScheduling) {
        await acquireUsageSlot(
          user_id,
          'timed_message_count',
          5,
          'timed_messages',
          session,
        );
      }
      updateCapsule = await Capsule.findOneAndUpdate(
        {_id: id, user: user_id, status: current.status},
        updateData,
        {new: true, session},
      );
      if (!updateCapsule) throw new NotFoundException('Capsule not found');
      if (current.status === 'scheduled' && nextStatus !== 'scheduled') {
        await applyUsageDelta(user_id, 'timed_message_count', -1, session);
      }
    });
  } finally {
    await session.endSession();
  }

  if (payload.status === 'scheduled' && updateCapsule?.schedule_date) {
    await scheduleCapsuleDelivery(
      updateCapsule.id,
      updateCapsule.schedule_date,
    );
  }

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

  void forgetUserContext(user_id);
  return {message: 'Capsule updated successfully', data: updateCapsule};
}

export async function scheduleCapsule(id: string, userId: string) {
  const capsule = await Capsule.findOne({_id: id, user: userId});
  if (!capsule) throw new NotFoundException('Capsule not found');

  if (!capsule.recipient_snapshots?.length && capsule.recipients.length) {
    const normalized = await normalizeCapsuleRecipients(
      capsule.recipients,
      userId,
    );
    capsule.recipients = normalized.legacyIds;
    capsule.recipient_snapshots = normalized.snapshots;
    capsule.recipients_snapshot_version = 1;
  }
  assertSchedulable(capsule);
  const session = await mongoose.startSession();
  let scheduledCapsule;
  try {
    await session.withTransaction(async () => {
      const current = await Capsule.findOne({_id: id, user: userId}).session(
        session,
      );
      if (!current) throw new NotFoundException('Capsule not found');
      if (current.status !== 'scheduled') {
        await acquireUsageSlot(
          userId,
          'timed_message_count',
          5,
          'timed_messages',
          session,
        );
      }
      scheduledCapsule = await Capsule.findOneAndUpdate(
        {_id: id, user: userId, status: current.status},
        {
          $set: {
            status: 'scheduled',
            recipients: capsule.recipients,
            recipient_snapshots: capsule.recipient_snapshots,
            recipients_snapshot_version: capsule.recipients_snapshot_version,
          },
        },
        {new: true, session},
      );
      if (!scheduledCapsule) throw new NotFoundException('Capsule not found');
    });
  } finally {
    await session.endSession();
  }
  await scheduleCapsuleDelivery(
    scheduledCapsule!.id,
    scheduledCapsule!.schedule_date!,
  );
  void forgetUserContext(userId);
  return {message: 'Capsule scheduled successfully', data: scheduledCapsule!};
}

export async function getCapsuleScheduleDate(
  id: string,
  userId: string,
): Promise<string | undefined> {
  const capsule = await Capsule.findOne({_id: id, user: userId})
    .select('schedule_date')
    .lean();
  if (!capsule) throw new NotFoundException('Capsule not found');
  return capsule.schedule_date
    ? dayjs(capsule.schedule_date).toISOString()
    : undefined;
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
          select: '-base64',
          match: {provider: {$ne: EXCLUDED_STORAGE_PROVIDER}},
        },
        {
          path: 'memories',
          select: '_id title body tags created_at attachments status',
          populate: {
            path: 'attachments',
            select: '-base64',
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
        select: '-base64',
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
  const session = await mongoose.startSession();
  let capsule;
  try {
    await session.withTransaction(async () => {
      capsule = await Capsule.findOneAndDelete({user, _id: id}, {session});
      if (!capsule) {
        throw new NotFoundException('Capsule not found');
      }
      await applyUsageDelta(user, 'time_capsule_count', -1, session);
      if (capsule.status === 'scheduled') {
        await applyUsageDelta(user, 'timed_message_count', -1, session);
      }
    });
  } finally {
    await session.endSession();
  }
  await track(
    {
      title: 'Capsule Deleted',
      description: `Deleted capsule: "${capsule!.title}"`,
      type: 'capsule',
      action: 'deleted',
      reference: capsule!.id,
    },
    user,
  );

  void forgetUserContext(user);
  return {message: 'Time capsule deleted successfully', data: capsule!};
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
