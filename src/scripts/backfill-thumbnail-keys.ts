import 'dotenv/config';
import mongoose from 'mongoose';
import {connectMongodb} from '../module/database/connection';
import File from '../module/database/model/file';
import {BACKEND_URL} from '../utils/config';

export type ThumbnailBackfillSummary = {
  commit: boolean;
  scanned: number;
  matched: number;
  updated: number;
  unmatched: number;
};

function isThumbnailKey(value: string): boolean {
  return value.startsWith('thumb_') || value.startsWith('thumbnails/');
}

export function extractThumbnailKey(
  value: unknown,
  backendUrl: string,
): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const candidate = value.trim();
  if (isThumbnailKey(candidate)) return candidate;

  try {
    const backend = new URL(backendUrl);
    const isRelative = candidate.startsWith('/');
    const parsed = new URL(candidate, backend);
    if (!isRelative && parsed.origin !== backend.origin) return null;

    const backendPath = backend.pathname.replace(/\/$/, '');
    const routePrefix = `${backendPath}/files/`.replace(/^\/\//, '/');
    if (!parsed.pathname.startsWith(routePrefix)) return null;

    const key = decodeURIComponent(parsed.pathname.slice(routePrefix.length));
    return isThumbnailKey(key) ? key : null;
  } catch {
    return null;
  }
}

export async function backfillThumbnailKeys(options: {
  backendUrl: string;
  commit?: boolean;
}): Promise<ThumbnailBackfillSummary> {
  const commit = options.commit === true;
  const files = await File.find({
    thumbnail: {$type: 'string', $ne: ''},
    $or: [
      {thumbnail_key: null},
      {thumbnail_key: ''},
      {thumbnail_key: {$exists: false}},
    ],
  }).select('_id thumbnail');

  let matched = 0;
  let updated = 0;
  for (const file of files) {
    const thumbnailKey = extractThumbnailKey(
      file.thumbnail,
      options.backendUrl,
    );
    if (!thumbnailKey) continue;
    matched += 1;
    if (!commit) continue;

    const result = await File.updateOne(
      {
        _id: file.id,
        $or: [
          {thumbnail_key: null},
          {thumbnail_key: ''},
          {thumbnail_key: {$exists: false}},
        ],
      },
      {$set: {thumbnail_key: thumbnailKey}},
    );
    updated += result.modifiedCount;
  }

  return {
    commit,
    scanned: files.length,
    matched,
    updated,
    unmatched: files.length - matched,
  };
}

async function main(): Promise<void> {
  if (!BACKEND_URL) throw new Error('BACKEND_URL is required');
  await connectMongodb();
  try {
    const summary = await backfillThumbnailKeys({
      backendUrl: BACKEND_URL,
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
