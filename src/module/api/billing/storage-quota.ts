import {randomUUID} from 'crypto';
import mongoose, {type ClientSession, type HydratedDocument} from 'mongoose';
import {StatusCodes} from 'http-status-codes';
import {
  STORAGE_LIMIT_FREE_BYTES,
  STORAGE_LIMIT_LEGACY_BYTES,
  STORAGE_LIMIT_PRO_BYTES,
  STORAGE_QUOTA_ENFORCEMENT_ENABLED,
  STORAGE_RESERVATION_TTL_SECONDS,
} from '../../../utils/config';
import {EXCLUDED_STORAGE_PROVIDER} from '../../../utils/constant';
import {ServiceError} from '../../../utils/service-error';
import File from '../../database/model/file';
import StorageReservation, {
  type IStorageReservation,
} from '../../database/model/storage-reservation';
import Subscription, {
  type SubscriptionTier,
} from '../../database/model/subscription';
import Usage from '../../database/model/usage';
import User from '../../database/model/user';
import {resolveEffectiveTier} from './access';

export type StorageUsageSummary = {
  used_bytes: number;
  reserved_bytes: number;
  limit_bytes: number;
  remaining_bytes: number;
  percent_used: number;
  over_limit: boolean;
};

class StorageQuotaExceeded extends ServiceError {
  constructor(data: Record<string, number | boolean>) {
    super(
      'Storage limit reached. Delete some media or upgrade to continue.',
      StatusCodes.FORBIDDEN,
      data,
      'failed',
      undefined,
      'storage_quota_exceeded',
    );
  }
}

export function resolveStorageLimit(
  tier: SubscriptionTier,
  explicitAdminOverride?: number | null,
): number {
  if (
    typeof explicitAdminOverride === 'number' &&
    Number.isFinite(explicitAdminOverride) &&
    explicitAdminOverride > 0
  ) {
    return Math.floor(explicitAdminOverride);
  }
  if (tier === 'pro') return STORAGE_LIMIT_PRO_BYTES;
  if (tier === 'legacy') return STORAGE_LIMIT_LEGACY_BYTES;
  return STORAGE_LIMIT_FREE_BYTES;
}

async function resolveUserStorageLimit(userId: string): Promise<number> {
  const [subscription, user] = await Promise.all([
    Subscription.findOne({user_id: userId}).lean(),
    User.findById(userId).select('+storage_limit_override_bytes').lean(),
  ]);
  return resolveStorageLimit(
    resolveEffectiveTier(subscription),
    user?.storage_limit_override_bytes,
  );
}

function quotaData(
  used: number,
  reserved: number,
  limit: number,
  requested: number,
) {
  return {
    used_bytes: used,
    reserved_bytes: reserved,
    limit_bytes: limit,
    remaining_bytes: Math.max(0, limit - used - reserved),
    requested_bytes: requested,
    over_limit: used > limit,
  };
}

async function ensureUsage(
  userId: string,
  limit: number,
  session: ClientSession,
): Promise<void> {
  await Usage.updateOne(
    {user_id: userId},
    {
      $setOnInsert: {
        user_id: userId,
        storage_used_bytes: 0,
        storage_reserved_bytes: 0,
      },
      $set: {storage_limit_bytes: limit, last_updated: new Date()},
    },
    {upsert: true, session},
  );
}

export async function reserveStorage(
  userId: string,
  requestedBytes: number,
  reservationId: string = randomUUID(),
  requestFingerprint?: string,
) {
  if (!Number.isFinite(requestedBytes) || requestedBytes <= 0) {
    throw new ServiceError(
      'Requested storage must be positive',
      StatusCodes.BAD_REQUEST,
    );
  }
  const requested = Math.ceil(requestedBytes);
  const limit = await resolveUserStorageLimit(userId);
  const session = await mongoose.startSession();
  let reservation: HydratedDocument<IStorageReservation> | null = null;
  let acquired = false;
  try {
    await session.withTransaction(async () => {
      const existing = await StorageReservation.findOne({
        reservation_id: reservationId,
      }).session(session);
      if (existing) {
        if (
          existing.user_id !== userId ||
          existing.requested_bytes !== requested ||
          (existing.request_fingerprint &&
            existing.request_fingerprint !== requestFingerprint)
        ) {
          throw new ServiceError(
            'Reservation key conflict',
            StatusCodes.CONFLICT,
          );
        }
        reservation = existing;
        return;
      }

      await ensureUsage(userId, limit, session);
      const usage = await Usage.findOneAndUpdate(
        {
          user_id: userId,
          $expr: {
            $lte: [
              {
                $add: [
                  {$ifNull: ['$storage_used_bytes', 0]},
                  {$ifNull: ['$storage_reserved_bytes', 0]},
                  requested,
                ],
              },
              STORAGE_QUOTA_ENFORCEMENT_ENABLED
                ? limit
                : Number.MAX_SAFE_INTEGER,
            ],
          },
        },
        {
          $inc: {storage_reserved_bytes: requested},
          $set: {storage_limit_bytes: limit, last_updated: new Date()},
        },
        {new: true, session},
      );
      if (!usage) {
        const current = await Usage.findOne({user_id: userId})
          .session(session)
          .lean();
        throw new StorageQuotaExceeded(
          quotaData(
            current?.storage_used_bytes || 0,
            current?.storage_reserved_bytes || 0,
            limit,
            requested,
          ),
        );
      }
      [reservation] = await StorageReservation.create(
        [
          {
            reservation_id: reservationId,
            user_id: userId,
            requested_bytes: requested,
            request_fingerprint: requestFingerprint,
            limit_bytes: limit,
            status: 'reserved',
            expires_at: new Date(
              Date.now() + STORAGE_RESERVATION_TTL_SECONDS * 1000,
            ),
          },
        ],
        {session},
      );
      acquired = true;
    });
  } finally {
    await session.endSession();
  }
  if (!reservation) throw new ServiceError('Storage reservation failed', 500);
  return {...reservation.toObject(), acquired};
}

export async function commitStorageReservation(
  reservationId: string,
  committedBytes: number,
  fileIds: string[] = [],
  externalSession?: ClientSession,
): Promise<void> {
  const finalBytes = Math.max(0, Math.ceil(committedBytes));
  const commit = async (session: ClientSession) => {
    const reservation = await StorageReservation.findOne({
      reservation_id: reservationId,
    }).session(session);
    if (reservation?.status === 'committed') return;
    if (!reservation || reservation.status !== 'reserved') {
      throw new ServiceError(
        'Storage reservation is no longer active',
        StatusCodes.CONFLICT,
        {reservation_id: reservationId},
        'failed',
        undefined,
        'storage_reservation_inactive',
      );
    }

    const usage = await Usage.findOneAndUpdate(
      {
        user_id: reservation.user_id,
        $expr: {
          $lte: [
            {
              $add: [
                {$ifNull: ['$storage_used_bytes', 0]},
                {$ifNull: ['$storage_reserved_bytes', 0]},
                finalBytes - reservation.requested_bytes,
              ],
            },
            STORAGE_QUOTA_ENFORCEMENT_ENABLED
              ? reservation.limit_bytes
              : Number.MAX_SAFE_INTEGER,
          ],
        },
      },
      {
        $inc: {
          storage_used_bytes: finalBytes,
          storage_reserved_bytes: -reservation.requested_bytes,
        },
        $set: {last_updated: new Date()},
      },
      {new: true, session},
    );
    if (!usage) {
      const current = await Usage.findOne({user_id: reservation.user_id})
        .session(session)
        .lean();
      throw new StorageQuotaExceeded(
        quotaData(
          current?.storage_used_bytes || 0,
          current?.storage_reserved_bytes || 0,
          reservation.limit_bytes,
          finalBytes,
        ),
      );
    }
    reservation.status = 'committed';
    reservation.committed_bytes = finalBytes;
    reservation.file_ids = fileIds;
    await reservation.save({session});
  };
  if (externalSession) {
    await commit(externalSession);
    return;
  }
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(() => commit(session));
  } finally {
    await session.endSession();
  }
}

export async function releaseStorageReservation(
  reservationId: string,
  status: 'released' | 'expired' = 'released',
): Promise<void> {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const reservation = await StorageReservation.findOneAndUpdate(
        {reservation_id: reservationId, status: 'reserved'},
        {$set: {status}},
        {new: true, session},
      );
      if (!reservation) return;
      await Usage.updateOne(
        {user_id: reservation.user_id},
        {
          $inc: {storage_reserved_bytes: -reservation.requested_bytes},
          $set: {last_updated: new Date()},
        },
        {session},
      );
    });
  } finally {
    await session.endSession();
  }
}

export async function reconcileStorageUsage(userId: string): Promise<void> {
  const [aggregate, reserved, limit] = await Promise.all([
    File.aggregate<{total: number}>([
      {
        $match: {
          user: userId,
          deleted: {$ne: true},
          provider: {$ne: EXCLUDED_STORAGE_PROVIDER},
        },
      },
      {$group: {_id: null, total: {$sum: '$size'}}},
    ]),
    StorageReservation.aggregate<{total: number}>([
      {
        $match: {
          user_id: userId,
          status: 'reserved',
          expires_at: {$gt: new Date()},
        },
      },
      {$group: {_id: null, total: {$sum: '$requested_bytes'}}},
    ]),
    resolveUserStorageLimit(userId),
  ]);
  await Usage.findOneAndUpdate(
    {user_id: userId},
    {
      $set: {
        storage_used_bytes: aggregate[0]?.total || 0,
        storage_reserved_bytes: reserved[0]?.total || 0,
        storage_limit_bytes: limit,
        last_updated: new Date(),
      },
      $setOnInsert: {user_id: userId},
    },
    {upsert: true},
  );
}

export async function releaseExpiredStorageReservations(): Promise<number> {
  const expired = await StorageReservation.find({
    status: 'reserved',
    expires_at: {$lte: new Date()},
  })
    .select('reservation_id')
    .limit(500)
    .lean();
  await Promise.all(
    expired.map(item =>
      releaseStorageReservation(item.reservation_id, 'expired'),
    ),
  );
  return expired.length;
}

export async function getStorageUsageSummary(
  userId: string,
): Promise<StorageUsageSummary> {
  const limit = await resolveUserStorageLimit(userId);
  await Usage.updateOne(
    {user_id: userId},
    {
      $setOnInsert: {
        user_id: userId,
        storage_used_bytes: 0,
        storage_reserved_bytes: 0,
      },
      $set: {storage_limit_bytes: limit},
    },
    {upsert: true},
  );
  const usage = await Usage.findOne({user_id: userId}).lean();
  const used = usage?.storage_used_bytes || 0;
  const reserved = usage?.storage_reserved_bytes || 0;
  return {
    used_bytes: used,
    reserved_bytes: reserved,
    limit_bytes: limit,
    remaining_bytes: Math.max(0, limit - used - reserved),
    percent_used: limit > 0 ? Math.round((used / limit) * 10_000) / 100 : 0,
    over_limit: used > limit,
  };
}
