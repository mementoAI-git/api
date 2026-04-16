import {Storage} from '@google-cloud/storage';
import {
  GCS_BUCKET_NAME,
  GCS_PROJECT_ID,
  GCS_KEY_FILENAME,
} from '../../../utils/config';
import type {
  StorageUploadResult,
  StorageFileMetadata,
  StorageGetFileResponse,
} from '../types';

const gcsStorage = new Storage({
  projectId: GCS_PROJECT_ID,
  ...(GCS_KEY_FILENAME ? {keyFilename: GCS_KEY_FILENAME} : {}),
});

function getBucket() {
  if (!GCS_BUCKET_NAME) {
    throw new Error('GCS_BUCKET_NAME is not configured');
  }
  return gcsStorage.bucket(GCS_BUCKET_NAME);
}

/**
 * Parse Range header value (e.g. "bytes=0-1023") into start and end.
 */
function parseRange(range: string): {start: number; end: number} | null {
  const match = range.match(/bytes=(\d+)-(\d*)/);
  if (!match) return null;
  const start = parseInt(match[1], 10);
  const end = match[2] ? parseInt(match[2], 10) : undefined;
  return {start, end: end ?? start};
}

/**
 * Upload a file to Google Cloud Storage (same interface as S3).
 */
export async function uploadToGCS(
  key: string,
  body: Buffer | Uint8Array | string,
  contentType: string,
  metadata?: Record<string, string>,
): Promise<StorageUploadResult> {
  const bucket = getBucket();
  const file = bucket.file(key);

  const buffer = Buffer.from(body);
  await file.save(buffer, {
    metadata: {
      contentType,
      metadata: metadata ?? {},
    },
  });

  const [fileMetadata] = await file.getMetadata();
  const etag = (fileMetadata.etag ?? '').replace(/"/g, '');
  const location = `https://storage.googleapis.com/${GCS_BUCKET_NAME}/${key}`;

  return {
    key,
    location,
    etag,
  };
}

/**
 * Get a file from GCS as a stream (same interface as S3).
 */
export async function getFileFromGCS(
  key: string,
  range?: string,
): Promise<StorageGetFileResponse> {
  const bucket = getBucket();
  const file = bucket.file(key);

  const options: {start?: number; end?: number} = {};
  if (range) {
    const parsed = parseRange(range);
    if (parsed) {
      options.start = parsed.start;
      options.end = parsed.end;
    }
  }

  const [metadata] = await file.getMetadata();
  const stream = file.createReadStream(options);

  return {
    Body: stream,
    ContentLength: metadata.size
      ? parseInt(String(metadata.size), 10)
      : undefined,
    ContentType: metadata.contentType,
  };
}

/**
 * Get file metadata from GCS (same interface as S3).
 */
export async function getFileMetadataFromGCS(
  key: string,
): Promise<StorageFileMetadata> {
  const bucket = getBucket();
  const file = bucket.file(key);
  const [metadata] = await file.getMetadata();

  const updated = metadata.updated ? new Date(metadata.updated) : new Date();
  const etag = (metadata.etag ?? '').replace(/"/g, '');
  const size = metadata.size ? parseInt(String(metadata.size), 10) : 0;

  return {
    size,
    lastModified: updated,
    etag,
    contentType: metadata.contentType,
  };
}

/**
 * Delete a file from GCS (same interface as S3).
 */
export async function deleteFileFromGCS(key: string): Promise<void> {
  const bucket = getBucket();
  const file = bucket.file(key);
  await file.delete();
}

/**
 * Generate a signed URL for file access (same interface as S3 presigned URL).
 */
export async function generatePresignedUrl(
  key: string,
  expiresIn = 3600,
): Promise<string> {
  const bucket = getBucket();
  const file = bucket.file(key);
  const [url] = await file.getSignedUrl({
    action: 'read',
    expires: Date.now() + expiresIn * 1000,
  });
  return url;
}

export default gcsStorage;
