import {Readable} from 'stream';
import cloudinary from '../../services/storage/cloudinary';
import * as gcsStorage from '../../services/storage/gcs';
import File, {IFile} from '../../module/database/model/file';
import logger from '../../utils/logger';

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

/**
 * Copies legacy GCS objects into Cloudinary (sets backup_at). Skips native Cloudinary rows.
 * Also removes Cloudinary objects for soft-deleted files that were previously backed up.
 */
export default async function backupFiles() {
  const files = await File.find({
    provider: {$ne: 's3'},
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

  let backedUp = 0;
  let failed = 0;
  let deleted = 0;
  const errors: string[] = [];

  for (const file of files) {
    try {
      if (!file?.backup_at && !file?.deleted && isLegacyGcsRow(file)) {
        await uploadToCloudinary(file as IFile);
        backedUp++;
      }

      if (file?.deleted && file.backup_at) {
        await deleteFromCloudinary(file as IFile);
        deleted++;
      }
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${file.name}: ${msg}`);
      logger.error(
        {err, key: file.name},
        'GCS → Cloudinary backup failed for file',
      );
    }
  }

  logger.info(
    {backedUp, failed, deleted, total: files.length},
    'Legacy GCS → Cloudinary backup pass completed',
  );
  return {
    backedUp,
    failed,
    skipped: files.length - backedUp - failed,
    deleted,
    errors: errors.slice(0, 50),
  };
}
