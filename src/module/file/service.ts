import { UploadedFile } from "express-fileupload";
import { isEmpty, reconstructFileName } from "../../utils/helpers";
import User from "../../model/user";
import File, { IFile } from "../../model/file";
import { NotFoundException, UnauthorizedException } from "../../utils/service-error";
import redis from "../../services/redis"
import { createHash } from "crypto";
import { Readable } from "stream";

export async function uploadFile(payload: UploadedFile[], user_id: string) {
  const user = await User.findById(user_id)
  if (!user) {
    throw new NotFoundException("User not found")
  }
  const files = payload.map(file => {
    return {
      name: reconstructFileName(file.name),
      base64: file.data.toString("base64"),
      user: user_id,
      size: file.size,
      type: file.mimetype
    }
  })

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

  await File.deleteOne({ name })
  return { data: file, message: "File deleted successfully" }
}

export async function getFile(name: string, range?: string) {
  const metadata = await getFileMetadata(name);
  const buffer = await getFileBuffer(name, metadata.size, range)

  // const file = await File.findOne({ name })
  // if (!file) {
  //   throw new NotFoundException("file not found")
  // }

  // const buffer = Buffer.from(file.base64, "base64");
  const data = { ...metadata, ...buffer }

  return { data, message: "File retrieved successfully" }
}

export async function getFileMetadata(name: string) {
  const key = `file-meta:${name}`
  const meta = await redis.get(key)
  if (meta) return JSON.parse(meta as string);

  const file = await File.findOne({ name });
  if (!file) {
    throw new NotFoundException("File not found");
  }

  const hash = createHash('md5');
  hash.update(`${name}-${file?.size || file.base64.length}`);
  const etag = `${hash.digest('hex')}`;

  const data = {
    etag,
    ...file.toJSON(),
    size: file?.size || file.base64.length
  }

  await redis.set(key, JSON.stringify(data));

  return data;
}

export async function getFileBuffer(name: string, size: number, range?: string) {
  let start: number | undefined;
  let end: number | undefined;

  if (range) {
    const byteRange = range.replace(/bytes=/, '').split('-');
    console.log({ byteRange })
    start = parseInt(byteRange[0], 10);
    end = byteRange[1] ? parseInt(byteRange[1], 10) : size - 1;
  }

  const rangeStr = range ? `-${start}-${end}` : '';
  const key = `file-buffer:${name}${rangeStr}`;

  const cachedData = await redis.get(key);
  if (cachedData) {
    const result = JSON.parse(cachedData as string)
    return { ...result, buffer: Buffer.from(result.buffer.data) };
  }

  let file: IFile;
  if (range && (end - start) < (5 * 1024 * 1024)) {
    console.log("range-")
    const base64Start = Math.floor(start * (4 / 3));
    const base64End = Math.ceil((end + 1) * (4 / 3));

    file = await File.findOne({ name }).select({
      name: 1,
      type: 1,
      size: 1,
      base64: { $substr: ['$base64', base64Start, base64End - base64Start] }
    });
  } else {
    console.log("direct")
    file = await File.findOne({ name });
  }

  if (!file) {
    throw new NotFoundException("File not found");
  }

  const buffer = Buffer.from(file.base64, "base64");
  const result = range ? buffer.subarray(start, end + 1) : buffer;

  const data = { buffer: result, start, end };
  if (result.length < 10 * 1024 * 1024) {
    await redis.set(
      key,
      JSON.stringify(data),
      { expiration: { type: "EX", value: 1800 } }
    );
  }

  return data
}

export function createFileStream(buffer: Buffer): Readable {
  const stream = new Readable();
  stream.push(buffer);
  stream.push(null);
  return stream;
}