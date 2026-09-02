import 'dotenv/config';
import mongoose from 'mongoose';
import {connectMongodb} from '../module/database/connection';
import Capsule from '../module/database/model/capsule';
import {normalizeCapsuleRecipients} from '../module/api/capsule/recipients';

export type CapsuleRecipientBackfillSummary = {
  commit: boolean;
  scanned: number;
  matched: number;
  updated: number;
  unresolved: number;
};

export async function backfillCapsuleRecipients(options: {
  commit?: boolean;
  batchSize?: number;
}): Promise<CapsuleRecipientBackfillSummary> {
  const commit = options.commit === true;
  const capsules = await Capsule.find({
    status: {$ne: 'received'},
    recipients: {$exists: true, $ne: []},
    $or: [
      {recipient_snapshots: {$exists: false}},
      {recipient_snapshots: {$size: 0}},
    ],
  })
    .select('_id user recipients')
    .limit(options.batchSize || 500);

  let matched = 0;
  let updated = 0;
  let unresolved = 0;
  for (const capsule of capsules) {
    try {
      const normalized = await normalizeCapsuleRecipients(
        capsule.recipients,
        String(capsule.user),
      );
      if (!normalized.snapshots.length) {
        unresolved += 1;
        continue;
      }
      matched += 1;
      if (!commit) continue;
      const result = await Capsule.updateOne(
        {
          _id: capsule._id,
          $or: [
            {recipient_snapshots: {$exists: false}},
            {recipient_snapshots: {$size: 0}},
          ],
        },
        {
          $set: {
            recipients: normalized.legacyIds,
            recipient_snapshots: normalized.snapshots,
            recipients_snapshot_version: 1,
          },
        },
      );
      updated += result.modifiedCount;
    } catch {
      unresolved += 1;
    }
  }

  return {commit, scanned: capsules.length, matched, updated, unresolved};
}

async function main(): Promise<void> {
  await connectMongodb();
  try {
    const summary = await backfillCapsuleRecipients({
      commit: process.argv.includes('--commit'),
    });
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  void main().catch(error => {
    process.stderr.write(`${String(error)}\n`);
    process.exitCode = 1;
  });
}
