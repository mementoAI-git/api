import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import {getSignedUrl} from '@aws-sdk/s3-request-presigner';
import {
  CLOUDFLARE_R2_ACCOUNT_ID,
  CLOUDFLARE_R2_ACCESS_KEY_ID,
  CLOUDFLARE_R2_SECRET_ACCESS_KEY,
  CLOUDFLARE_R2_BUCKET_NAME,
  AWS_REGION,
  AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY,
  AWS_S3_BUCKET_NAME,
  HETZNER_ENDPOINT,
  HETZNER_ACCESS_KEY_ID,
  HETZNER_SECRET_ACCESS_KEY,
  HETZNER_BUCKET_NAME,
} from '../../../utils/config';

// Initialize Cloudflare R2 client (Primary)
export const cloudflareClient = new S3Client({
  region: AWS_REGION,
  endpoint: CLOUDFLARE_R2_ACCOUNT_ID
    ? `https://${CLOUDFLARE_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
    : undefined,
  credentials: {
    accessKeyId: CLOUDFLARE_R2_ACCESS_KEY_ID || AWS_ACCESS_KEY_ID || 'dummy',
    secretAccessKey: CLOUDFLARE_R2_SECRET_ACCESS_KEY || AWS_SECRET_ACCESS_KEY || 'dummy',
  },
});

// Initialize Hetzner client (Backup)
export const hetznerClient = new S3Client({
  region: 'us-east-1',
  endpoint: HETZNER_ENDPOINT || undefined,
  credentials: {
    accessKeyId: HETZNER_ACCESS_KEY_ID || 'dummy',
    secretAccessKey: HETZNER_SECRET_ACCESS_KEY || 'dummy',
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
 * Expose helper to resolve active client and bucket dynamically
 */
export function getStorageTarget(target: 'primary' | 'backup' = 'primary') {
  if (target === 'backup') {
    return {
      client: hetznerClient,
      bucket: HETZNER_BUCKET_NAME || 'dummy-backup-bucket',
    };
  }
  return {
    client: cloudflareClient,
    bucket: CLOUDFLARE_R2_BUCKET_NAME || AWS_S3_BUCKET_NAME || 'dummy-primary-bucket',
  };
}

/**
 * Upload a file to S3 (Primary or Backup)
 */
export async function uploadToS3(
  key: string,
  body: Buffer | Uint8Array | string,
  contentType: string,
  metadata?: Record<string, string>,
  target: 'primary' | 'backup' = 'primary',
): Promise<S3UploadResult> {
  const {client, bucket} = getStorageTarget(target);

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
    Metadata: metadata,
  });

  const result = await client.send(command);

  let location = '';
  if (target === 'primary') {
    location = CLOUDFLARE_R2_ACCOUNT_ID
      ? `https://${CLOUDFLARE_R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${bucket}/${key}`
      : `https://${bucket}.s3.${AWS_REGION}.amazonaws.com/${key}`;
  } else {
    location = `${HETZNER_ENDPOINT || 'https://s3.amazonaws.com'}/${bucket}/${key}`;
  }

  return {
    key,
    location,
    etag: result.ETag || '',
  };
}

/**
 * Get a file from S3 as a stream
 */
export async function getFileFromS3(
  key: string,
  range?: string,
  target: 'primary' | 'backup' = 'primary',
) {
  const {client, bucket} = getStorageTarget(target);

  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
    Range: range,
  });

  const result = await client.send(command);
  return result;
}

/**
 * Get file metadata from S3
 */
export async function getFileMetadataFromS3(
  key: string,
  target: 'primary' | 'backup' = 'primary',
): Promise<S3FileMetadata> {
  const {client, bucket} = getStorageTarget(target);

  const command = new HeadObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  const result = await client.send(command);

  return {
    size: result.ContentLength || 0,
    lastModified: result.LastModified || new Date(),
    etag: result.ETag || '',
    contentType: result.ContentType,
  };
}

/**
 * Delete a file from S3 (Primary, Backup, or Both)
 */
export async function deleteFileFromS3(
  key: string,
  target: 'primary' | 'backup' | 'both' = 'primary',
): Promise<void> {
  const targets: ('primary' | 'backup')[] = [];
  if (target === 'both') {
    targets.push('primary', 'backup');
  } else {
    targets.push(target);
  }

  await Promise.all(
    targets.map(async t => {
      const {client, bucket} = getStorageTarget(t);
      const command = new DeleteObjectCommand({
        Bucket: bucket,
        Key: key,
      });
      await client.send(command);
    }),
  );
}

/**
 * Generate a presigned URL for file access
 */
export async function generatePresignedUrl(
  key: string,
  expiresIn = 3600,
  target: 'primary' | 'backup' = 'primary',
): Promise<string> {
  const {client, bucket} = getStorageTarget(target);

  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  return await getSignedUrl(client, command, {expiresIn});
}

export default cloudflareClient;
