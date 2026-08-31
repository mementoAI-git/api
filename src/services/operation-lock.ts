import {randomUUID} from 'crypto';
import mongoose from '../module/database/connection';

const LOCK_LEASE_MS = 30_000;
const LOCK_WAIT_MS = 5_000;
const LOCK_POLL_MS = 20;

function isDuplicateKeyError(error: unknown): error is {code: number} {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as {code?: unknown}).code === 11000
  );
}

export async function withOperationLock<T>(
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  if (!mongoose.connection.db) {
    throw new Error('MongoDB must be connected before acquiring a lock');
  }
  const locks = mongoose.connection.db.collection<{
    _id: string;
    owner: string;
    expires_at: Date;
  }>('operation_locks');
  const owner = randomUUID();
  const deadline = Date.now() + LOCK_WAIT_MS;
  let acquired = false;

  while (!acquired && Date.now() < deadline) {
    const now = new Date();
    try {
      const lock = await locks.findOneAndUpdate(
        {_id: key, $or: [{expires_at: {$lte: now}}, {owner}]},
        {$set: {owner, expires_at: new Date(now.getTime() + LOCK_LEASE_MS)}},
        {upsert: true, returnDocument: 'after'},
      );
      acquired = lock?.owner === owner;
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
    }
    if (!acquired) {
      await new Promise(resolve => setTimeout(resolve, LOCK_POLL_MS));
    }
  }

  if (!acquired) throw new Error(`Timed out acquiring operation lock: ${key}`);

  try {
    return await operation();
  } finally {
    await locks.deleteOne({_id: key, owner});
  }
}
