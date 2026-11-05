import type {mongo, HydratedDocument} from 'mongoose';
import Memory, {IMemory} from '../module/database/model/memory';
import File from '../module/database/model/file';
import Message from '../module/database/model/message';
import Bookmark from '../module/database/model/bookmarks';
import ActivePrompt from '../module/database/model/active-prompt';
import PendingInsight from '../module/database/model/pending-insight';
import {removeMemoryFromInsights} from './insights';
import Capsule from '../module/database/model/capsule';
import SharedItem from '../module/database/model/shared-item';
import {BadRequestException, NotFoundException} from '../utils/service-error';
import {deleteFileEverywhere} from './storage';
import logger from '../utils/logger';

export const MEMORY_RECOVERY_MS = 30 * 24 * 60 * 60 * 1000;

/** Never infer deletion time from created_at/updated_at. Legacy rows get a fresh window. */
export async function backfillMemoryRecovery(
  db: mongo.Db,
  now = new Date(),
  user?: string,
) {
  await db.collection('memories').updateMany(
    {
      status: 'deleted',
      ...(user ? {user} : {}),
      $or: [{deleted_at: null}, {delete_after: null}],
    },
    {
      $set: {
        deleted_at: now,
        delete_after: new Date(now.getTime() + MEMORY_RECOVERY_MS),
        previous_status: 'save',
      },
    },
  );
}

export async function moveMemoryToDeleted(
  id: string,
  user: string,
  now = new Date(),
) {
  const memory = await Memory.findOneAndUpdate(
    {_id: id, user, status: {$ne: 'deleted'}},
    [
      {
        $set: {
          previous_status: '$status',
          status: 'deleted',
          deleted_at: now,
          delete_after: new Date(now.getTime() + MEMORY_RECOVERY_MS),
        },
      },
    ],
    {new: true},
  );
  if (memory) return memory;
  const existing = await Memory.findOne({
    _id: id,
    user,
    purge_requested_at: null,
  });
  if (!existing) throw new NotFoundException('Memory not found');
  return existing; // Retrying Delete must not reset the recovery clock.
}

export async function recoverDeletedMemory(
  id: string,
  user: string,
  now = new Date(),
) {
  if (Memory.db.db) await backfillMemoryRecovery(Memory.db.db, now, user);
  const memory = await Memory.findOneAndUpdate(
    {
      _id: id,
      user,
      status: 'deleted',
      purge_requested_at: null,
      delete_after: {$gt: now},
    },
    [
      {
        $set: {
          status: {
            $cond: [
              {
                $in: [
                  '$previous_status',
                  ['draft', 'save', 'queued', 'on_chain'],
                ],
              },
              '$previous_status',
              'save',
            ],
          },
        },
      },
      {$unset: ['deleted_at', 'delete_after', 'previous_status']},
    ],
    {new: true},
  );
  if (memory) return memory;
  const existing = await Memory.findOne({_id: id, user});
  if (!existing) throw new NotFoundException('Memory not found');
  throw new BadRequestException(
    existing.status === 'deleted'
      ? 'This memory can no longer be restored.'
      : 'Memory is not deleted',
  );
}

/** Claim irreversibly in the request; provider cleanup belongs in the worker. */
export async function requestMemoryPurge(
  id: string,
  user: string,
  now = new Date(),
) {
  const memory = await Memory.findOneAndUpdate(
    {_id: id, user, status: 'deleted'},
    {$set: {purge_requested_at: now}},
    {new: true},
  );
  if (memory) return memory;
  if (!(await Memory.exists({_id: id, user})))
    throw new NotFoundException('Memory not found');
  throw new BadRequestException(
    'Move the memory to Deleted before deleting it permanently.',
  );
}

function isMissingObject(error: unknown) {
  const e = error as {
    name?: string;
    status?: number;
    statusCode?: number;
    $metadata?: {httpStatusCode?: number};
  };
  return (
    e?.status === 404 ||
    e?.statusCode === 404 ||
    e?.$metadata?.httpStatusCode === 404 ||
    ['NotFound', 'NotFoundException', 'NoSuchKey'].includes(e?.name || '')
  );
}

async function purgeClaimedMemory(memory: HydratedDocument<IMemory>) {
  const messages = await Message.find({memory: memory.id})
    .select('attatchments')
    .lean();
  const fileIds = [
    ...new Set([
      ...memory.attachments.map(String),
      ...messages.flatMap(message => message.attatchments || []),
    ]),
  ];
  for (const id of fileIds) {
    const [otherMemory, otherMessage, capsule, shared] = await Promise.all([
      Memory.exists({_id: {$ne: memory.id}, attachments: id}),
      Message.exists({memory: {$ne: memory.id}, attatchments: id}),
      Capsule.exists({attachments: id}),
      SharedItem.exists({source_id: id, removed_at: null}),
    ]);
    if (otherMemory || otherMessage || capsule || shared) continue;
    const file = await File.findOneAndUpdate(
      {_id: id, user: memory.user},
      {$set: {deleted: true}},
      {new: true},
    ).select('+backup_at');
    if (!file) continue;
    // Keep database keys until both primary and backups have been removed, for retries.
    for (const key of [file.name, file.thumbnail_key].filter(
      (value): value is string => !!value,
    )) {
      try {
        await deleteFileEverywhere(
          key,
          key === file.name ? file.provider || 'gcs' : 's3',
          file.type,
          key === file.name ? !!file.backup_at : true,
        );
      } catch (error) {
        if (!isMissingObject(error)) throw error;
      }
    }
    await File.deleteOne({_id: file.id, deleted: true});
  }
  await Promise.all([
    Message.deleteMany({memory: memory.id}),
    Bookmark.deleteMany({memory: memory.id}),
    ActivePrompt.deleteMany({memory: memory.id}),
    PendingInsight.deleteMany({memory: memory.id}),
    removeMemoryFromInsights(memory.id),
    SharedItem.deleteMany({source_id: memory.id}),
    Capsule.updateMany({memories: memory.id}, {$pull: {memories: memory.id}}),
  ]);
  await Memory.deleteOne({
    _id: memory.id,
    status: 'deleted',
    purge_requested_at: {$ne: null},
  });
}

/** A durable claim makes restoration and cleanup mutually exclusive, including retries. */
export async function purgeExpiredMemories(now = new Date()): Promise<number> {
  const eligible = {
    $or: [{delete_after: {$lte: now}}, {purge_requested_at: {$ne: null}}],
  };
  const available = {
    $or: [
      {purge_processing_at: null},
      {purge_processing_at: {$lte: new Date(now.getTime() - 15 * 60 * 1000)}},
    ],
  };
  const candidates = await Memory.find({
    status: 'deleted',
    $and: [eligible, available],
  })
    .select('_id')
    .limit(100)
    .lean();
  let purged = 0;
  let failed = 0;
  for (const candidate of candidates) {
    const memory = await Memory.findOneAndUpdate(
      {_id: candidate._id, status: 'deleted', $and: [eligible, available]},
      {$set: {purge_requested_at: now, purge_processing_at: now}},
      {new: true},
    );
    if (!memory) continue;
    try {
      await purgeClaimedMemory(memory);
      purged++;
    } catch (error) {
      failed++;
      await Memory.updateOne(
        {_id: memory.id},
        {$unset: {purge_processing_at: 1}},
      );
      logger.error(
        {err: error, memoryId: memory.id},
        'Memory purge failed; durable claim retained for retry',
      );
    }
  }
  if (failed)
    throw new Error(
      `Memory cleanup failed for ${failed} memories; retry required`,
    );
  return purged;
}
