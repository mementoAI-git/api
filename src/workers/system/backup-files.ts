import {Readable} from 'stream';
import cloudinary from '../../services/storage/cloudinary';
import * as gcsStorage from '../../services/storage/gcs';
import {
  getFileFromS3,
  uploadToS3,
  deleteFileFromS3,
} from '../../services/storage/s3';
import File, {IFile} from '../../module/database/model/file';
import logger from '../../utils/logger';
import {DEFAULT_STORAGE_PROVIDER} from '../../utils/constant';

function streamToBuffer(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', chunk => chunks.push(Buffer.from(chunk)));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

function getResourceType(mimetype: string): 'image' | 'video' | 'raw' | 'auto' {
  if (mimetype.startsWith('image/')) return 'image';
  if (mimetype.startsWith('video/') || mimetype.startsWith('audio/'))
    return 'video';
  return 'raw';
}

// Legacy GCS to Cloudinary Backup
async function uploadToCloudinary(file: IFile): Promise<void> {
  const response = await gcsStorage.getFileFromGCS(file.name);
  if (!response.Body) {
    throw new Error('File not found');
  }
  const buffer = await streamToBuffer(response.Body as Readable);
  const resourceType = getResourceType(file.type || '');

  await new Promise<void>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: resourceType,
        public_id: file.name,
        overwrite: true,
        folder: 'memento',
      },
      (err, result) => {
        if (err) reject(err);
        else if (!result) reject(new Error('No result from Cloudinary'));
        else resolve();
      },
    );
    stream.end(buffer);
  });

  await File.updateOne({name: file.name}, {$set: {backup_at: new Date()}});
}

function cloudinaryPublicIdForBackup(fileName: string): string {
  return fileName.includes('/') ? fileName : `memento/${fileName}`;
}

async function deleteFromCloudinary(file: IFile): Promise<void> {
  const publicId = cloudinaryPublicIdForBackup(file.name);
  await cloudinary.uploader.destroy(publicId, {
    resource_type: getResourceType(file.type || ''),
  });
  await File.deleteOne({name: file.name});
}

function isLegacyGcsRow(file: {provider?: string}): boolean {
  return file.provider === 'gcs' || file.provider === undefined;
}

// Cloudflare R2 (Primary) to Hetzner (Backup)
async function backupToHetzner(file: IFile): Promise<void> {
  const response = await getFileFromS3(file.name, undefined, 'primary');
  if (!response.Body) {
    throw new Error('File not found on R2 primary storage');
  }
  const buffer = await streamToBuffer(response.Body as Readable);

  // Upload to Hetzner (backup target)
  await uploadToS3(
    file.name,
    buffer,
    file.type || 'application/octet-stream',
    undefined,
    'backup',
  );

  await File.updateOne(
    {name: file.name},
    {
      $set: {
        backup_at: new Date(),
      },
    },
  );
}

async function deleteFromBothS3Buckets(file: IFile): Promise<void> {
  // Delete from both R2 and Hetzner
  await deleteFileFromS3(file.name, 'both');
  await File.deleteOne({name: file.name});
}

/**
 * Copies native R2 (s3) files to Hetzner, and handles legacy GCS → Cloudinary backups.
 * Also cleans up soft-deleted files from R2/Hetzner or Cloudinary permanently.
 */
export default async function backupFiles() {
  // 1. Process primary S3/R2 files (Primary -> Backup Hetzner & dual deletes)
  const s3Files = await File.find({
    provider: DEFAULT_STORAGE_PROVIDER,
    $or: [
      {
        $and: [
          {deleted: {$ne: true}},
          {$or: [{backup_at: {$exists: false}}, {backup_at: null}]},
        ],
      },
      {deleted: true},
    ],
  })
    .select('_id name type provider backup_at deleted')
    .sort({_id: 1})
    .limit(50)
    .lean();

  let backedUp = 0;
  let failed = 0;
  let deleted = 0;
  const errors: string[] = [];

  for (const file of s3Files) {
    try {
      if (!file?.deleted && !file?.backup_at) {
        await backupToHetzner(file as IFile);
        backedUp++;
      } else if (file?.deleted) {
        await deleteFromBothS3Buckets(file as IFile);
        deleted++;
      }
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`[S3] ${file.name}: ${msg}`);
      logger.error(
        {err, key: file.name},
        'R2 → Hetzner backup/delete failed for file',
      );
    }
  }

  // 2. Process legacy GCS files (Legacy GCS -> Cloudinary & legacy deletes)
  const legacyFiles = await File.find({
    provider: {$ne: DEFAULT_STORAGE_PROVIDER},
    $or: [
      {
        $and: [
          {$or: [{provider: 'gcs'}, {provider: {$exists: false}}]},
          {$or: [{backup_at: {$exists: false}}, {backup_at: null}]},
          {deleted: {$ne: true}},
        ],
      },
      {deleted: true, backup_at: {$exists: true, $ne: null}},
    ],
  })
    .select('_id name type provider backup_at deleted')
    .sort({_id: 1})
    .limit(50)
    .lean();

  for (const file of legacyFiles) {
    try {
      if (!file?.backup_at && !file?.deleted && isLegacyGcsRow(file)) {
        await uploadToCloudinary(file as IFile);
        backedUp++;
      } else if (file?.deleted && file.backup_at) {
        await deleteFromCloudinary(file as IFile);
        deleted++;
      }
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`[Legacy] ${file.name}: ${msg}`);
      logger.error(
        {err, key: file.name},
        'GCS → Cloudinary backup/delete failed for legacy file',
      );
    }
  }

  logger.info(
    {backedUp, failed, deleted, total: s3Files.length + legacyFiles.length},
    'Backup and deletion cleanup pass completed',
  );

  return {
    backedUp,
    failed,
    deleted,
    errors: errors.slice(0, 50),
  };
}
