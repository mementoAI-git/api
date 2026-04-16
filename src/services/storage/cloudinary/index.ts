import {v2 as cloudinary} from 'cloudinary';
import {
  CLOUDINARY_CLOUD_NAME,
  CLOUDINARY_API_KEY,
  CLOUDINARY_API_SECRET,
} from '../../../utils/config';
import type {StorageGetFileResponse} from '../types';
import {reconstructFileName} from '../../../utils/helpers';

cloudinary.config({
  cloud_name: CLOUDINARY_CLOUD_NAME,
  api_key: CLOUDINARY_API_KEY,
  api_secret: CLOUDINARY_API_SECRET,
});

export interface CloudinaryUploadImageOptions {
  folder?: string;
  /** Optional public_id (unique name). If omitted, one is generated from originalName. */
  public_id?: string;
  originalName?: string;
}

export interface CloudinaryUploadImageResult {
  name: string;
  url: string;
  size: number;
  type: string;
}

const DEFAULT_FOLDER = 'memento';

export type CloudinaryResourceType = 'image' | 'video' | 'raw' | 'auto';

export function getResourceType(mimetype: string): CloudinaryResourceType {
  if (mimetype.startsWith('image/')) return 'image';
  if (mimetype.startsWith('video/') || mimetype.startsWith('audio/'))
    return 'video';
  return 'raw';
}

export interface CloudinaryUploadFileOptions
  extends CloudinaryUploadImageOptions {
  resource_type?: CloudinaryResourceType;
}

/**
 * Upload any file (image, video, or raw) to Cloudinary.
 * Use when GCS is disabled so all uploads go to Cloudinary.
 */
export async function uploadFile(
  buffer: Buffer,
  mimetype: string,
  size: number,
  options: CloudinaryUploadFileOptions = {},
): Promise<CloudinaryUploadImageResult> {
  const folder = options.folder ?? DEFAULT_FOLDER;
  const baseName =
    options.public_id ?? reconstructFileName(options.originalName ?? 'file');
  const resourceType = options.resource_type ?? getResourceType(mimetype);

  const result = await new Promise<{secure_url: string}>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: resourceType,
        public_id: baseName,
        overwrite: true,
        folder,
      },
      (err, result) => {
        if (err) reject(err);
        else if (!result) reject(new Error('No result from Cloudinary'));
        else resolve({secure_url: result.secure_url ?? ''});
      },
    );
    stream.end(buffer);
  });

  const fullPublicId = `${folder}/${baseName}`;
  return {
    name: fullPublicId,
    url: result.secure_url,
    size,
    type: mimetype,
  };
}

/**
 * Upload an image buffer to Cloudinary.
 * Returns metadata suitable for storing in the File model (name is full public_id including folder).
 */
export async function uploadImage(
  buffer: Buffer,
  mimetype: string,
  size: number,
  options: CloudinaryUploadImageOptions = {},
): Promise<CloudinaryUploadImageResult> {
  const folder = options.folder ?? DEFAULT_FOLDER;
  const baseName =
    options.public_id ?? reconstructFileName(options.originalName ?? 'image');

  const result = await new Promise<{secure_url: string}>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: 'image',
        public_id: baseName,
        overwrite: true,
        folder,
      },
      (err, result) => {
        if (err) reject(err);
        else if (!result) reject(new Error('No result from Cloudinary'));
        else resolve({secure_url: result.secure_url ?? ''});
      },
    );
    stream.end(buffer);
  });

  const fullPublicId = `${folder}/${baseName}`;
  return {
    name: fullPublicId,
    url: result.secure_url,
    size,
    type: mimetype,
  };
}

/** Build the public URL for a Cloudinary resource (no auth required). */
export function getFileUrl(
  publicId: string,
  resourceType: CloudinaryResourceType = 'image',
): string {
  if (!CLOUDINARY_CLOUD_NAME) {
    throw new Error('CLOUDINARY_CLOUD_NAME is not configured');
  }
  return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/${resourceType}/upload/${publicId}`;
}

/** @deprecated Use getFileUrl(publicId, 'image'). */
export function getImageUrl(publicId: string): string {
  return getFileUrl(publicId, 'image');
}

/** Delete a file from Cloudinary by public_id and resource type. */
export async function deleteFile(
  publicId: string,
  resourceType: CloudinaryResourceType = 'image',
): Promise<void> {
  await cloudinary.uploader.destroy(publicId, {
    resource_type: resourceType,
  });
}

/** @deprecated Use deleteFile(publicId, 'image'). */
export async function deleteImage(publicId: string): Promise<void> {
  await deleteFile(publicId, 'image');
}

/** Get file as stream (fetches from Cloudinary URL). Used for compatibility with storage layer. */
export async function getFileStream(
  publicId: string,
  resourceType: CloudinaryResourceType = 'image',
): Promise<StorageGetFileResponse> {
  const axios = (await import('axios')).default;
  const url = getFileUrl(publicId, resourceType);
  const response = await axios({
    method: 'GET',
    url,
    responseType: 'stream',
  });
  return {
    Body: response.data as NodeJS.ReadableStream,
    ContentLength: response.headers['content-length']
      ? Number(response.headers['content-length'])
      : undefined,
    ContentType: response.headers['content-type'],
  };
}

/** @deprecated Use getFileStream(publicId, 'image'). */
export async function getImageStream(
  publicId: string,
): Promise<StorageGetFileResponse> {
  return getFileStream(publicId, 'image');
}

export default cloudinary;
