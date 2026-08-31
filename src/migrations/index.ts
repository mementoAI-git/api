import type {mongo} from 'mongoose';
import mongoose from '../module/database/connection';
import Migration from '../module/database/model/migration';
import {MIGRATIONS} from './definitions';
import {randomUUID} from 'crypto';

type Db = mongo.Db;

export interface DatabaseMigration {
  id: string;
  up: (db: Db) => Promise<void>;
}

export interface MigrationStatus {
  id: string;
  status: 'applied' | 'pending' | 'running' | 'failed';
  applied_at?: Date;
  failed_at?: Date;
  lease_expires_at?: Date;
}

export interface MigrationRunResult {
  id: string;
  status: 'applied' | 'skipped';
}

export interface MigrationRunOptions {
  leaseMs?: number;
  pollMs?: number;
  waitTimeoutMs?: number;
}

function getDatabase(): Db {
  if (!mongoose.connection.db) {
    throw new Error('MongoDB must be connected before running migrations');
  }
  return mongoose.connection.db;
}

function isDuplicateKeyError(error: unknown): error is {code: number} {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as {code?: unknown}).code === 11000
  );
}

const MIGRATION_LEASE_MS = 15 * 60 * 1000;
const MIGRATION_WAIT_MS = 30 * 60 * 1000;
const MIGRATION_POLL_MS = 100;

async function ensureMigrationTrackingIndex(): Promise<void> {
  await Migration.collection.createIndex(
    {id: 1},
    {name: 'migration_id_unique', unique: true},
  );
}

export async function getMigrationStatus(
  migrations: readonly DatabaseMigration[] = MIGRATIONS,
): Promise<MigrationStatus[]> {
  await ensureMigrationTrackingIndex();
  const records = await Migration.find({
    id: {$in: migrations.map(migration => migration.id)},
  }).lean();
  const byId = new Map(records.map(record => [record.id, record]));

  return migrations.map(migration => {
    const record = byId.get(migration.id);
    if (!record) return {id: migration.id, status: 'pending'};
    if (record.status === 'applied' || record.applied_at) {
      return {
        id: migration.id,
        status: 'applied',
        applied_at: record.applied_at,
      };
    }
    return {
      id: migration.id,
      status: record.status || 'pending',
      failed_at: record.failed_at,
      lease_expires_at: record.lease_expires_at,
    };
  });
}

async function claimMigration(id: string, owner: string, leaseMs: number) {
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + leaseMs);
  try {
    return await Migration.create({
      id,
      status: 'running',
      owner,
      lease_expires_at: leaseExpiresAt,
    });
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
  }

  return Migration.findOneAndUpdate(
    {
      id,
      $or: [
        {status: 'failed'},
        {status: 'running', lease_expires_at: {$lte: now}},
        {
          status: {$exists: false},
          applied_at: {$exists: false},
        },
      ],
    },
    {
      $set: {status: 'running', owner, lease_expires_at: leaseExpiresAt},
      $unset: {failed_at: 1, error: 1},
    },
    {new: true},
  );
}

async function waitForMigration(
  id: string,
  pollMs: number,
  waitTimeoutMs: number,
): Promise<'applied' | 'claimable'> {
  const deadline = Date.now() + waitTimeoutMs;
  while (Date.now() < deadline) {
    const record = await Migration.findOne({id}).lean();
    if (record?.status === 'applied' || record?.applied_at) return 'applied';
    if (
      !record ||
      record.status === 'failed' ||
      (record.status === 'running' &&
        record.lease_expires_at &&
        record.lease_expires_at.getTime() <= Date.now())
    ) {
      return 'claimable';
    }
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }
  throw new Error(`Timed out waiting for concurrent migration: ${id}`);
}

async function runClaimedMigration(
  migration: DatabaseMigration,
  db: Db,
  owner: string,
  leaseMs: number,
): Promise<void> {
  let renewalError: Error | null = null;
  let renewal = Promise.resolve();
  const renewEveryMs = Math.max(10, Math.floor(leaseMs / 3));
  const timer = setInterval(() => {
    renewal = renewal.then(async () => {
      const renewed = await Migration.updateOne(
        {id: migration.id, owner, status: 'running'},
        {$set: {lease_expires_at: new Date(Date.now() + leaseMs)}},
      );
      if (renewed.modifiedCount !== 1) {
        throw new Error(`Migration lease lost: ${migration.id}`);
      }
    });
    renewal.catch(error => {
      renewalError = error instanceof Error ? error : new Error(String(error));
    });
  }, renewEveryMs);
  timer.unref();

  try {
    await migration.up(db);
  } finally {
    clearInterval(timer);
    await renewal.catch(() => undefined);
  }

  if (renewalError) throw renewalError;
}

export async function migrateUp(
  migrations: readonly DatabaseMigration[] = MIGRATIONS,
  options: MigrationRunOptions = {},
): Promise<MigrationRunResult[]> {
  const db = getDatabase();
  const leaseMs = options.leaseMs || MIGRATION_LEASE_MS;
  const pollMs = options.pollMs || MIGRATION_POLL_MS;
  const waitTimeoutMs = options.waitTimeoutMs || MIGRATION_WAIT_MS;
  await ensureMigrationTrackingIndex();
  const results: MigrationRunResult[] = [];

  for (const migration of migrations) {
    const owner = randomUUID();
    let claimed = false;
    let alreadyApplied = false;
    while (!claimed && !alreadyApplied) {
      const claim = await claimMigration(migration.id, owner, leaseMs);
      if (claim && claim.owner === owner && claim.status === 'running') {
        claimed = true;
        continue;
      }

      const state = await waitForMigration(migration.id, pollMs, waitTimeoutMs);
      if (state === 'applied') {
        results.push({id: migration.id, status: 'skipped'});
        alreadyApplied = true;
      }
    }
    if (alreadyApplied) continue;

    try {
      await runClaimedMigration(migration, db, owner, leaseMs);
      const completed = await Migration.updateOne(
        {id: migration.id, owner, status: 'running'},
        {
          $set: {status: 'applied', applied_at: new Date()},
          $unset: {owner: 1, lease_expires_at: 1, failed_at: 1, error: 1},
        },
      );
      if (completed.modifiedCount !== 1) {
        throw new Error(`Migration lease lost: ${migration.id}`);
      }
      results.push({id: migration.id, status: 'applied'});
    } catch (error) {
      await Migration.updateOne(
        {id: migration.id, owner, status: 'running'},
        {
          $set: {
            status: 'failed',
            failed_at: new Date(),
            error: (error instanceof Error
              ? error.message
              : String(error)
            ).slice(0, 500),
          },
          $unset: {owner: 1, lease_expires_at: 1},
        },
      );
      throw error;
    }
  }

  return results;
}

export {MIGRATIONS};
