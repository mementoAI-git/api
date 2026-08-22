import sharp from 'sharp';
import {getFileFromGCS, getFileMetadataFromGCS, deleteFileFromGCS} from './gcs';
import {
  getFileFromS3,
  getFileMetadataFromS3,
  deleteFileFromS3,
  uploadToS3,
} from './s3';
import * as cloudinaryStorage from './cloudinary';
import logger from '../../utils/logger';
import {
  getMediaDuration,
  resolveUploadMime,
  reconstructFileName,
} from '../../utils/helpers';
import type {IFile} from '../../module/database/model/file';
import type {StorageFileMetadata, StorageGetFileResponse} from './types';
import type {FileStorageProvider} from '../../module/database/model/file';
import {
  DEFAULT_STORAGE_PROVIDER,
  FREE_STORAGE_LIMIT_BYTES,
  EXCLUDED_STORAGE_PROVIDER,
} from '../../utils/constant';
import User, {IUser} from '../../module/database/model/user';
import File from '../../module/database/model/file';
import {ForbiddenException, NotFoundException} from '../../utils/service-error';
import {BACKEND_URL} from '../../utils/config';

function isStorageNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const candidate = error as {
    name?: string;
    message?: string;
    $metadata?: {httpStatusCode?: number};
  };

  if (candidate.$metadata?.httpStatusCode === 404) {
    return true;
  }

  return candidate.name === 'NotFound' || candidate.message === 'UnknownError';
}

function resolvePublicFileUrl(key: string, fallback = ''): string {
  if (BACKEND_URL) {
    const base = BACKEND_URL.replace(/\/$/, '');
    return `${base}/files/${encodeURIComponent(key)}`;
  }
  return fallback;
}

export async function uploadFile(
  file: Express.Multer.File,
  user: string,
  clientDuration?: number,
): Promise<Partial<IFile>> {
  let mimetype = resolveUploadMime(file);
  let buffer = file.buffer;
  let originalName = file.originalname;

  const isLargeMediaFile = file.size > 8 * 1024 * 1024;

  if (
    isLargeMediaFile &&
    (mimetype.startsWith('video/') || mimetype.startsWith('audio/'))
  ) {
    logger.warn(
      {file: originalName, size: file.size},
      'Large media upload detected; skipping expensive derivative generation',
    );
  }

  // Perform server-side image compression and conversion (e.g. HEIC -> JPEG) if it's an image
  if (mimetype.startsWith('image/') && mimetype !== 'image/svg+xml') {
    try {
      if (mimetype === 'image/heic' || mimetype === 'image/heif') {
        // HEIC/HEIF is not natively supported in most web browsers.
        // Convert to progressive JPEG for compatibility and efficient storage.
        buffer = await sharp(file.buffer)
          .jpeg({quality: 80, progressive: true})
          .toBuffer();
        mimetype = 'image/jpeg';

        // Update originalName extension to .jpg so the generated key has correct extension
        const extIndex = originalName.lastIndexOf('.');
        if (extIndex !== -1) {
          originalName = originalName.substring(0, extIndex) + '.jpg';
        } else {
          originalName = originalName + '.jpg';
        }
      } else if (mimetype === 'image/png') {
        // Compress PNGs safely using quality and compression options
        buffer = await sharp(file.buffer)
          .png({quality: 80, compressionLevel: 8})
          .toBuffer();
      } else if (mimetype === 'image/jpeg' || mimetype === 'image/jpg') {
        // Compress JPEGs using high quality and progressive loading
        buffer = await sharp(file.buffer)
          .jpeg({quality: 80, progressive: true})
          .toBuffer();
      } else if (mimetype === 'image/webp') {
        // Compress WebP
        buffer = await sharp(file.buffer).webp({quality: 80}).toBuffer();
      }
    } catch (err) {
      logger.warn(
        {file: originalName, err},
        'Image compression failed, falling back to original buffer',
      );
      // Fallback is automatic as buffer and mimetype remain the original values
    }
  }

  const base64 = buffer.toString('base64');
  const detectedDuration = await getMediaDuration(base64, mimetype);
  // Use client-supplied duration if server-side detection fails (e.g. WebM from MediaRecorder)
  const duration = detectedDuration ?? clientDuration;
  let width: number | undefined;
  let height: number | undefined;
  let status: IFile['status'] = 'ready';

  let thumbnail: string | null = null;

  // ── Extract embedded album art from audio files ────────────────────────────
  // Only for uploaded audio files that may have ID3/iTunes embedded cover art.
  // Voice recordings (audio/m4a named voice_*.m4a) rarely have cover art but we
  // still attempt — it's a no-op if no cover is present.
  if (mimetype.startsWith('audio/') && !isLargeMediaFile) {
    try {
      const mm = await import('music-metadata');
      const metadata = await mm.parseBuffer(buffer, {mimeType: mimetype});
      const cover = mm.selectCover(metadata.common.picture);
      if (cover?.data && cover.data.length > 0) {
        const thumbKey = reconstructFileName(
          `thumb_${originalName.replace(/\.[^.]+$/, '')}.jpg`,
        );
        const thumbUpload = await uploadToS3(
          thumbKey,
          Buffer.from(cover.data),
          'image/jpeg',
        );
        thumbnail = resolvePublicFileUrl(thumbKey, thumbUpload.location);
      }
    } catch (err) {
      // No cover art or parse failure — non-fatal, skip silently
      logger.warn({file: originalName, err}, 'Album art extraction skipped');
    }
  }

  if (mimetype.startsWith('image/') && mimetype !== 'image/svg+xml') {
    try {
      const normalizedImage = sharp(buffer).rotate();
      const imageMetadata = await normalizedImage.metadata();
      width = imageMetadata.width;
      height = imageMetadata.height;

      const previewBuffer = await normalizedImage
        .clone()
        .resize({width: 800, withoutEnlargement: true})
        .jpeg({quality: 75, progressive: true})
        .toBuffer();
      const thumbKey = reconstructFileName(
        `thumb_${originalName.replace(/\.[^.]+$/, '')}.jpg`,
      );
      const thumbUpload = await uploadToS3(
        thumbKey,
        previewBuffer,
        'image/jpeg',
      );
      thumbnail = resolvePublicFileUrl(thumbKey, thumbUpload.location);
    } catch (err) {
      logger.warn(
        {file: originalName, err},
        'Image thumbnail generation failed',
      );
      thumbnail = null;
    }
  }

  // Upload to Cloudflare R2 S3-compatible primary storage
  const key = reconstructFileName(originalName);
  const result = await uploadToS3(key, buffer, mimetype);

  if (mimetype.startsWith('video/')) {
    status = 'processing';
    thumbnail = null;
  } else if (mimetype.startsWith('audio/') && !thumbnail) {
    status = 'processing';
  }

  return {
    name: result.key,
    user,
    size: buffer.length, // Save compressed size
    type: mimetype, // Save potentially converted mimetype
    duration,
    width,
    height,
    status,
    thumbnail,
    provider: DEFAULT_STORAGE_PROVIDER,
    backup_url: result.location,
  };
}

/**
 * Get file metadata from the storage backend for this file (uses file's provider or falls back to STORAGE_PROVIDER).
 */
export async function getFileMetadata(
  key: string,
  provider: FileStorageProvider = DEFAULT_STORAGE_PROVIDER,
  mimeType?: string,
): Promise<StorageFileMetadata> {
  if (provider === 'gcs') {
    return getFileMetadataFromGCS(key);
  }
  if (provider === 'cloudinary') {
    if (!mimeType) {
      throw new Error('mimeType is required for Cloudinary file metadata');
    }
    return cloudinaryStorage.getFileMetadataFromCloudinary(key, mimeType);
  }

  if (provider === 's3') {
    try {
      return await getFileMetadataFromS3(key, 'primary');
    } catch (primaryError) {
      logger.warn(
        {key, err: primaryError},
        'Primary metadata fetch failed, falling back to backup',
      );
      try {
        return await getFileMetadataFromS3(key, 'backup');
      } catch (backupError) {
        if (
          isStorageNotFoundError(primaryError) &&
          isStorageNotFoundError(backupError)
        ) {
          throw new NotFoundException('File not found');
        }
        throw backupError;
      }
    }
  }

  return getFileMetadataFromS3(key);
}

/**
 * Get file stream from the storage backend for this file (uses file's provider or falls back to STORAGE_PROVIDER).
 */
export async function getFile(
  key: string,
  range?: string,
  provider: FileStorageProvider = DEFAULT_STORAGE_PROVIDER,
  mimeType?: string,
): Promise<StorageGetFileResponse> {
  if (provider === 'gcs') {
    return getFileFromGCS(key, range);
  }
  if (provider === 'cloudinary') {
    if (!mimeType) {
      throw new Error('mimeType is required for Cloudinary file fetch');
    }
    const resourceType = cloudinaryStorage.getResourceType(mimeType);
    return cloudinaryStorage.getFileStream(key, resourceType, range);
  }

  if (provider === 's3') {
    try {
      const result = await getFileFromS3(key, range, 'primary');
      return {
        Body: result.Body as NodeJS.ReadableStream,
        ContentLength: result.ContentLength,
        ContentType: result.ContentType,
      };
    } catch (primaryError) {
      logger.warn(
        {key, err: primaryError},
        'Primary storage fetch failed, trying backup',
      );
      try {
        const result = await getFileFromS3(key, range, 'backup');
        return {
          Body: result.Body as NodeJS.ReadableStream,
          ContentLength: result.ContentLength,
          ContentType: result.ContentType,
        };
      } catch (backupError) {
        if (
          isStorageNotFoundError(primaryError) &&
          isStorageNotFoundError(backupError)
        ) {
          throw new NotFoundException('File not found');
        }
        logger.error(
          {key, err: backupError},
          'Backup storage fetch failed too',
        );
        throw backupError;
      }
    }
  }

  const result = await getFileFromS3(key, range);
  return {
    Body: result.Body as NodeJS.ReadableStream,
    ContentLength: result.ContentLength,
    ContentType: result.ContentType,
  };
}

/**
 * Delete a file from the storage backend for this file (uses file's provider or falls back to STORAGE_PROVIDER).
 */
export async function deleteFile(
  key: string,
  provider: FileStorageProvider = DEFAULT_STORAGE_PROVIDER,
  mimeType?: string,
): Promise<void> {
  if (provider === 'gcs') {
    return deleteFileFromGCS(key);
  }
  if (provider === 'cloudinary') {
    if (!mimeType) {
      throw new Error('mimeType is required for Cloudinary delete');
    }
    return cloudinaryStorage.deleteFile(
      key,
      cloudinaryStorage.getResourceType(mimeType),
    );
  }
  if (provider === 's3') {
    return deleteFileFromS3(key, 'primary');
  }
  return deleteFileFromS3(key);
}

export async function getUserStorageUsed(user_id: string): Promise<number> {
  const result = await File.aggregate<{total: number}>([
    {
      $match: {
        user: user_id,
        deleted: false,
        provider: {$ne: EXCLUDED_STORAGE_PROVIDER},
      },
    },
    {$group: {_id: null, total: {$sum: '$size'}}},
  ]);
  return result[0]?.total ?? 0;
}

export async function checkStorageQuota(
  user: string | IUser,
  additional_bytes = 0,
) {
  let _user: null | IUser = typeof user !== 'string' ? user : null;

  if (!_user) {
    _user = await User.findById(user).select('storage_limit').lean();
  }

  const storage_limit = _user?.storage_limit || FREE_STORAGE_LIMIT_BYTES;
  const used = await getUserStorageUsed(_user?._id);

  const data = {
    used,
    limit: storage_limit,
  };

  if (used + additional_bytes > storage_limit) {
    throw new ForbiddenException(
      'Storage limit exceeded. Upgrade for more space.',
      data,
    );
  }

  return data;
}
