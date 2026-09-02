import 'dotenv/config';
import mongoose from 'mongoose';
import {connectMongodb} from '../module/database/connection';
import Capsule from '../module/database/model/capsule';
import File from '../module/database/model/file';
import Memory from '../module/database/model/memory';
import Message from '../module/database/model/message';

type CountMap = Record<string, number>;

function increment(counts: CountMap, key: string): void {
  counts[key] = (counts[key] || 0) + 1;
}

export async function auditFileAccess() {
  const files = await File.find({deleted: {$ne: true}})
    .select('name provider access_mode thumbnail thumbnail_key')
    .lean();
  const byProvider: CountMap = {};
  const byAccessMode: CountMap = {};
  const thumbnailRepresentation: CountMap = {};

  for (const file of files) {
    increment(byProvider, file.provider || 'unknown');
    increment(byAccessMode, file.access_mode || 'legacy_public');
    const hasKey = Boolean(file.thumbnail_key);
    const hasUrl = Boolean(file.thumbnail);
    increment(
      thumbnailRepresentation,
      hasKey && hasUrl
        ? 'key_and_legacy_url'
        : hasKey
          ? 'key_only'
          : hasUrl
            ? 'legacy_url_only'
            : 'none',
    );
  }

  const [memoryFileIds, capsuleFileIds, messageFileIds] = await Promise.all([
    Memory.distinct('attachments', {status: {$ne: 'deleted'}}),
    Capsule.distinct('attachments'),
    Message.distinct('attatchments'),
  ]);
  const referencedFileIds = new Set(
    [...memoryFileIds, ...capsuleFileIds, ...messageFileIds].map(String),
  );

  return {
    total_active_files: files.length,
    by_provider: byProvider,
    by_access_mode: byAccessMode,
    thumbnail_representation: thumbnailRepresentation,
    missing_storage_identity: {
      original_key: files.filter(file => !file.name).length,
      thumbnail_key_with_legacy_url: files.filter(
        file => file.thumbnail && !file.thumbnail_key,
      ).length,
    },
    active_references: {
      memories: memoryFileIds.length,
      capsules: capsuleFileIds.length,
      messages: messageFileIds.length,
      unique_files: referencedFileIds.size,
    },
  };
}

async function main(): Promise<void> {
  await connectMongodb();
  try {
    process.stdout.write(`${JSON.stringify(await auditFileAccess())}\n`);
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
