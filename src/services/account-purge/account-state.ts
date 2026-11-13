import type {ClientSession} from 'mongoose';
import PurgeCommand from '../../module/database/model/purge-command';
import User from '../../module/database/model/user';
import {withTransaction} from '../../utils/helpers';

/** Days a deleted account stays recoverable before its data is purged. */
export const ACCOUNT_DELETION_GRACE_DAYS = 14;
export const ACCOUNT_DELETION_GRACE_MS =
  ACCOUNT_DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000;

type DeletionState = {
  deleted?: boolean;
  disabled?: boolean;
  purge_status?: string;
  deletion_scheduled_for?: Date | null;
};

/** A deleted account that can still be restored by signing in. */
export function isWithinDeletionGrace(
  user: DeletionState,
  now = new Date(),
): boolean {
  return Boolean(
    user.deleted &&
      !user.disabled &&
      user.purge_status === 'purge_pending' &&
      user.deletion_scheduled_for &&
      new Date(user.deletion_scheduled_for).getTime() > now.getTime(),
  );
}

/**
 * Restores an account inside its grace period. Atomic with the purge worker:
 * the command is removed only while still pending and not yet due, so a purge
 * that has started can never be undone half-way. Returns false when too late.
 */
export async function reactivateAccount(userId: string): Promise<boolean> {
  return withTransaction(async (session: ClientSession) => {
    const now = new Date();
    const command = await PurgeCommand.findOneAndDelete(
      {user_id: userId, status: 'pending', available_at: {$gt: now}},
      {session},
    );
    if (!command) return false;
    const restored = await User.updateOne(
      {
        _id: userId,
        deleted: true,
        disabled: {$ne: true},
        purge_status: 'purge_pending',
      },
      {
        $set: {
          deleted: false,
          purge_status: 'active',
          deletion_requested_at: null,
          deletion_scheduled_for: null,
          deletion_reason: null,
          deletion_details: null,
        },
      },
      {session},
    );
    if (restored.modifiedCount !== 1) {
      throw new Error('Account could not be restored');
    }
    return true;
  });
}

export async function isActiveAccount(userId: string): Promise<boolean> {
  return Boolean(
    await User.exists({
      _id: userId,
      deleted: {$ne: true},
      disabled: {$ne: true},
      purge_status: {$nin: ['purge_pending', 'purged']},
    }),
  );
}
