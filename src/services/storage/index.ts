import {getFileFromGCS, getFileMetadataFromGCS, deleteFileFromGCS} from './gcs';
import {getFileFromS3, getFileMetadataFromS3, deleteFileFromS3} from './s3';
import * as cloudinaryStorage from './cloudinary';
import {getMediaDuration, resolveUploadMime} from '../../utils/helpers';
import type {IFile} from '../../module/database/model/file';
import type {StorageFileMetadata, StorageGetFileResponse} from './types';
import type {FileStorageProvider} from '../../module/database/model/file';
import {
  DEFAULT_STORAGE_PROVIDER,
  FREE_STORAGE_LIMIT_BYTES,
  STORAGE_PROVIDERS,
} from '../../utils/constant';
import User, {IUser} from '../../module/database/model/user';
import File from '../../module/database/model/file';
import {ForbiddenException} from '../../utils/service-error';

export async function uploadFile(
  file: Express.Multer.File,
  user: string,
  clientDuration?: number,
): Promise<Partial<IFile>> {
  const mimetype = resolveUploadMime(file);
  const base64 = file.buffer.toString('base64');
  const detectedDuration = await getMediaDuration(base64, mimetype);
  // Use client-supplied duration if server-side detection fails (e.g. WebM from MediaRecorder)
  const duration = detectedDuration ?? clientDuration;

  const result = await cloudinaryStorage.uploadFile(
    file.buffer,
    mimetype,
    file.size,
    {originalName: file.originalname},
  );

  return {
    name: result.name,
    user,
    size: result.size,
    type: result.type,
    duration,
    provider: DEFAULT_STORAGE_PROVIDER,
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
  return deleteFileFromS3(key);
}

export async function getUserStorageUsed(user_id: string): Promise<number> {
  const result = await File.aggregate<{total: number}>([
    {
      $match: {
        user: user_id,
        deleted: false,
        provider: {$ne: STORAGE_PROVIDERS.s3},
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
