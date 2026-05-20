import sharp from 'sharp';
import {getFileFromGCS, getFileMetadataFromGCS, deleteFileFromGCS} from './gcs';
import {
  getFileFromS3,
  getFileMetadataFromS3,
  deleteFileFromS3,
  uploadToS3,
} from './s3';
import * as cloudinaryStorage from './cloudinary';
import {getMediaDuration, resolveUploadMime, reconstructFileName} from '../../utils/helpers';
import type {IFile} from '../../module/database/model/file';
import type {StorageFileMetadata, StorageGetFileResponse} from './types';
import type {FileStorageProvider} from '../../module/database/model/file';
import {
  DEFAULT_STORAGE_PROVIDER,
  FREE_STORAGE_LIMIT_BYTES,
  STORAGE_PROVIDERS,
  EXCLUDED_STORAGE_PROVIDER,
} from '../../utils/constant';
import User, {IUser} from '../../module/database/model/user';
import File from '../../module/database/model/file';
import {ForbiddenException} from '../../utils/service-error';

export async function uploadFile(
  file: Express.Multer.File,
  user: string,
  clientDuration?: number,
): Promise<Partial<IFile>> {
  let mimetype = resolveUploadMime(file);
  let buffer = file.buffer;
  let originalName = file.originalname;

  // Perform server-side image compression and conversion (e.g. HEIC -> JPEG) if it's an image
  if (mimetype.startsWith('image/') && mimetype !== 'image/svg+xml') {
    try {
      if (mimetype === 'image/heic' || mimetype === 'image/heif') {
        // HEIC/HEIF is not natively supported in most web browsers.
        // Convert to progressive JPEG for compatibility and efficient storage.
        buffer = await sharp(file.buffer)
          .jpeg({ quality: 80, progressive: true })
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
          .png({ quality: 80, compressionLevel: 8 })
          .toBuffer();
      } else if (mimetype === 'image/jpeg' || mimetype === 'image/jpg') {
        // Compress JPEGs using high quality and progressive loading
        buffer = await sharp(file.buffer)
          .jpeg({ quality: 80, progressive: true })
          .toBuffer();
      } else if (mimetype === 'image/webp') {
        // Compress WebP
        buffer = await sharp(file.buffer)
          .webp({ quality: 80 })
          .toBuffer();
      }
    } catch (err) {
      console.error(`Image compression failed for ${originalName}, falling back to original buffer:`, err);
      // Fallback is automatic as buffer and mimetype remain the original values
    }
  }

  const base64 = buffer.toString('base64');
  const detectedDuration = await getMediaDuration(base64, mimetype);
  // Use client-supplied duration if server-side detection fails (e.g. WebM from MediaRecorder)
  const duration = detectedDuration ?? clientDuration;

  // Upload to Cloudflare R2 S3-compatible primary storage
  const key = reconstructFileName(originalName);
  const result = await uploadToS3(key, buffer, mimetype);

  return {
    name: result.key,
    user,
    size: buffer.length, // Save compressed size
    type: mimetype,      // Save potentially converted mimetype
    duration,
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
      console.warn(`Primary metadata fetch failed for ${key}, falling back to backup:`, primaryError);
      return await getFileMetadataFromS3(key, 'backup');
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
      console.warn(`Primary storage fetch failed for ${key}, trying backup:`, primaryError);
      try {
        const result = await getFileFromS3(key, range, 'backup');
        return {
          Body: result.Body as NodeJS.ReadableStream,
          ContentLength: result.ContentLength,
          ContentType: result.ContentType,
        };
      } catch (backupError) {
        console.error(`Backup storage fetch failed for ${key} too:`, backupError);
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
