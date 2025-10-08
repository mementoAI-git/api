
import { UploadedFile } from "express-fileupload";
import { processFile } from "../../../utils/helpers";
import User from "../../database/model/user";
import File from "../../database/model/file";
import { NotFoundException, UnauthorizedException } from "../../../utils/service-error";
import redis from "../../../services/redis"
import { createHash } from "crypto";
import { Readable } from "stream";
import {
  getFileFromS3,
  getFileMetadataFromS3,
  deleteFileFromS3
} from "../../media";

export async function uploadFile(payload: UploadedFile[], user_id: string) {
  const user = await User.findById(user_id)
  if (!user) {
    throw new NotFoundException("User not found")
  }

  const files = await Promise.all(
    payload.map((file) => processFile(file, user_id))
  )

  const data = await File.insertMany(files)

  return { message: "File uploaded successfully", data }
}

export async function removeFile(name: string, user_id: string) {
  const file = await File.findOne({ name })
  if (!file) {
    throw new NotFoundException("file not found")
  }
  if (file.user !== user_id) {
    throw new UnauthorizedException()
  }

  // Delete file from S3
  await deleteFileFromS3(file.name);

  // Delete file record from database
  await File.deleteOne({ name })
  return { data: file, message: "File deleted successfully" }
}

export async function getFileMetadata(name: string) {
  const key = `file-meta:${name}`

  const meta = await redis.get(key)
  if (meta) return JSON.parse(meta as string);

  const file = await File.findOne({ name });
  if (!file) {
    throw new NotFoundException("File not found");
  }

  // Get metadata from S3
  const s3Metadata = await getFileMetadataFromS3(file.name);

  const hash = createHash('md5');
  hash.update(`${file.name}-${file.size}`);
  const etag = s3Metadata.etag || `${hash.digest('hex')}`;

  const data = {
    etag,
    ...file.toJSON(),
    size: s3Metadata.size,
    lastModified: s3Metadata.lastModified
  }


  return data;
}

export async function getFileBuffer(name: string, size: number, range?: string) {
  let start: number | undefined;
  let end: number | undefined;
  const chunk_size = 0.5 * 1024 * 1024;

  if (range) {
    const byte_range = range.replace(/bytes=/, '').split('-');
    start = parseInt(byte_range[0], 10);
    end = Math.min(start + chunk_size, size - 1);
  }

  const rangeStr = range ? `-${start}-${end}` : '';
  const key = `file-buffer:${name}${rangeStr}`;

  const cachedData = await redis.get(key);
  if (cachedData) {
    const result = JSON.parse(cachedData as string)
    return { ...result, buffer: Buffer.from(result.buffer.data) };
  }

  const file = await File.findOne({ name });
  if (!file) {
    throw new NotFoundException("File not found");
  }

  // Get file from S3
  const s3Range = range ? `bytes=${start}-${end}` : undefined;
  const s3Response = await getFileFromS3(file.name, s3Range);

  if (!s3Response.Body) {
    throw new NotFoundException("File content not found");
  }

  // Convert S3 stream to buffer
  const chunks: Uint8Array[] = [];
  const stream = s3Response.Body as Readable;

  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  const buffer = Buffer.concat(chunks);

  const data = { buffer, start, end, chunk_size };
  await redis.set(
    key,
    JSON.stringify(data),
    { expiration: { type: "EX", value: 1800 } }
  );

  return data
}

export function createFileStream(buffer: Buffer): Readable {
  const stream = new Readable();
  stream.push(buffer);
  stream.push(null);

  return stream;
}