import { uploadToGCS, getFileFromGCS, getFileMetadataFromGCS, deleteFileFromGCS } from './gcs';
import { getFileFromS3, getFileMetadataFromS3, deleteFileFromS3 } from './s3';
import { reconstructFileName, getMediaDuration } from '../../utils/helpers';
import type { IFile } from '../../module/database/model/file';
import type { StorageFileMetadata, StorageGetFileResponse } from './types';
import type { FileStorageProvider } from '../../module/database/model/file';
import { DEFAULT_STORAGE_PROVIDER } from '../../utils/constant';

export async function uploadFile(
  file: Express.Multer.File,
  user: string,
): Promise<Partial<IFile>> {
  const fileName = reconstructFileName(file.originalname);

  const uploadResult = await uploadToGCS(fileName, file.buffer, file.mimetype, {
    originalName: file.originalname,
    userId: user,
    uploadedAt: new Date().toISOString(),
  });

  const base64 = file.buffer.toString('base64');
  const duration = await getMediaDuration(base64, file.mimetype);

  return {
    name: uploadResult?.key,
    user,
    size: file.size,
    type: file.mimetype,
    duration,
    provider: DEFAULT_STORAGE_PROVIDER,
  };
}

/**
 * Get file metadata from the storage backend for this file (uses file's provider or falls back to STORAGE_PROVIDER).
 */
export async function getFileMetadata(
  key: string,
  provider: FileStorageProvider = DEFAULT_STORAGE_PROVIDER
): Promise<StorageFileMetadata> {
  if (provider === 'gcs') {
    return getFileMetadataFromGCS(key);
  }
  return getFileMetadataFromS3(key);
}

/**
 * Get file stream from the storage backend for this file (uses file's provider or falls back to STORAGE_PROVIDER).
 */
export async function getFile(
  key: string,
  range?: string,
  provider: FileStorageProvider = DEFAULT_STORAGE_PROVIDER
): Promise<StorageGetFileResponse> {
  if (provider === 'gcs') {
    return getFileFromGCS(key, range);
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
  provider: FileStorageProvider = DEFAULT_STORAGE_PROVIDER
): Promise<void> {
  if (provider === 'gcs') {
    return deleteFileFromGCS(key);
  }
  return deleteFileFromS3(key);
}
