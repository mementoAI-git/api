/**
 * Shared storage interface used by both S3 and GCS implementations.
 */

export interface StorageUploadResult {
  key: string;
  location: string;
  etag: string;
}

export interface StorageFileMetadata {
  size: number;
  lastModified: Date;
  etag: string;
  contentType?: string;
}

/** Response shape for getFile - compatible with S3 GetObjectCommand output */
export interface StorageGetFileResponse {
  Body: NodeJS.ReadableStream;
  ContentLength?: number;
  ContentType?: string;
}
