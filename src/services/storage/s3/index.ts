import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_S3_BUCKET_NAME } from '../../../utils/config';

// Initialize S3 client
const s3Client = new S3Client({
  region: AWS_REGION,
  credentials: {
    accessKeyId: AWS_ACCESS_KEY_ID!,
    secretAccessKey: AWS_SECRET_ACCESS_KEY!,
  },
});

export interface S3UploadResult {
  key: string;
  location: string;
  etag: string;
}

export interface S3FileMetadata {
  size: number;
  lastModified: Date;
  etag: string;
  contentType?: string;
}

/**
 * Upload a file to S3
 */
export async function uploadToS3(
  key: string,
  body: Buffer | Uint8Array | string,
  contentType: string,
  metadata?: Record<string, string>
): Promise<S3UploadResult> {
  const command = new PutObjectCommand({
    Bucket: AWS_S3_BUCKET_NAME,
    Key: key,
    Body: body,
    ContentType: contentType,
    Metadata: metadata,
  });

  const result = await s3Client.send(command);

  return {
    key,
    location: `https://${AWS_S3_BUCKET_NAME}.s3.${AWS_REGION}.amazonaws.com/${key}`,
    etag: result.ETag || '',
  };
}

/**
 * Get a file from S3 as a stream
 */
export async function getFileFromS3(key: string, range?: string) {
  const command = new GetObjectCommand({
    Bucket: AWS_S3_BUCKET_NAME,
    Key: key,
    Range: range,
  });

  const result = await s3Client.send(command);
  return result;
}

/**
 * Get file metadata from S3
 */
export async function getFileMetadataFromS3(key: string): Promise<S3FileMetadata> {
  const command = new HeadObjectCommand({
    Bucket: AWS_S3_BUCKET_NAME,
    Key: key,
  });

  const result = await s3Client.send(command);

  return {
    size: result.ContentLength || 0,
    lastModified: result.LastModified || new Date(),
    etag: result.ETag || '',
    contentType: result.ContentType,
  };
}

/**
 * Delete a file from S3
 */
export async function deleteFileFromS3(key: string): Promise<void> {
  const command = new DeleteObjectCommand({
    Bucket: AWS_S3_BUCKET_NAME,
    Key: key,
  });

  await s3Client.send(command);
}

/**
 * Generate a presigned URL for file access
 */
export async function generatePresignedUrl(
  key: string,
  expiresIn: number = 3600
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: AWS_S3_BUCKET_NAME,
    Key: key,
  });

  return await getSignedUrl(s3Client, command, { expiresIn });
}

export default s3Client;

