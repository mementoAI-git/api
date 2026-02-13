import * as storage from "../../../services/storage";
import { filterGenerator } from "../../../utils/helpers";
import User from "../../database/model/user";
import File from "../../database/model/file";
import { NotFoundException, UnauthorizedException } from "../../../utils/service-error";
import { IPagination } from "../../../utils/interface";
import redis from "../../../services/redis"
import { createHash } from "crypto";
import { Readable } from "stream";
import { STORAGE_PROVIDERS } from "../../../utils/constant";

export async function uploadFile(payload: Express.Multer.File[], user_id: string) {
  const user = await User.findById(user_id)
  if (!user) {
    throw new NotFoundException("User not found")
  }

  const files = await Promise.all(
    payload.map((file) => storage.uploadFile(file, user_id))
  )

  const data = await File.insertMany(files)

  return { message: "File uploaded successfully", data }
}

export async function removeFile(name: string, user_id: string) {
  const file = await File.findActiveOne({ name }).select("+backup_at");
  if (!file) {
    throw new NotFoundException("file not found");
  }
  if (file.user !== user_id) {
    throw new UnauthorizedException();
  }

  const isBackedUp = !!file.backup_at;

  if (isBackedUp) {
    await File.updateOne({ name }, { $set: { deleted: true } });
  } else {
    if ((file.provider ?? STORAGE_PROVIDERS.s3) === STORAGE_PROVIDERS.gcs) {
      await storage.deleteFile(file.name, STORAGE_PROVIDERS.gcs);
    }
    await File.deleteOne({ name });
  }

  return { data: file, message: "File deleted successfully" };
}

export async function getFileMetadata(name: string) {
  const key = `file-meta:${name}`

  const meta = await redis.get(key)
  if (meta) return JSON.parse(meta as string);

  const file = await File.findActiveOne({ name });
  if (!file) {
    throw new NotFoundException("File not found");
  }

  const result = await storage.getFileMetadata(file.name, file.provider ?? STORAGE_PROVIDERS.gcs);

  const hash = createHash('md5');
  hash.update(`${file.name}-${file.size}`);
  const etag = result.etag || `${hash.digest('hex')}`;

  return {
    etag,
    ...file.toJSON(),
    size: result.size,
    lastModified: result.lastModified
  };
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

  const file = await File.findActiveOne({ name })
  if (!file) {
    throw new NotFoundException("File not found");
  }

  const rangeHeader = range ? `bytes=${start}-${end}` : undefined;
  const fileResponse = await storage.getFile(file.name, rangeHeader, file.provider ?? 's3');

  if (!fileResponse.Body) {
    throw new NotFoundException("File content not found");
  }

  const chunks: Uint8Array[] = [];
  const stream = fileResponse.Body as Readable;

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

export async function getFiles(payload: IPagination, user_id: string) {
  const { page, limit, ...query } = payload;

  const filters = filterGenerator(query, ["name", "type"]);

  filters.push(
    { user: user_id },
    { provider: { $ne: STORAGE_PROVIDERS.s3 } },
    { deleted: false },
  );

  const data = await File.paginate(
    { $and: filters },
    {
      limit,
      page,
      sort: { created_at: -1, updated_at: -1 },
      select: "-base64" // Exclude base64 data from response
    }
  );

  return { message: "Files retrieved successfully", data };
}