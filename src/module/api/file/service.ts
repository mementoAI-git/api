import * as storage from '../../../services/storage';
import {filterGenerator} from '../../../utils/helpers';
import User from '../../database/model/user';
import File, {type IFile} from '../../database/model/file';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ServiceError,
} from '../../../utils/service-error';
import {IPagination} from '../../../utils/interface';
import redis from '../../../services/redis';
import {createHash} from 'crypto';
import {Readable} from 'stream';
import {
  DEFAULT_STORAGE_PROVIDER,
  EXCLUDED_STORAGE_PROVIDER,
} from '../../../utils/constant';
import {queueAttachmentThumbnailProcessing} from '../../../services/queues/system';
import Memory from '../../database/model/memory';
import Capsule from '../../database/model/capsule';
import Message from '../../database/model/message';
import {StatusCodes} from 'http-status-codes';
import type {Request} from 'express';
import {
  FileVariant,
  verifyFileCapability,
} from '../../../services/storage/file-capability';
import {parseFileCapabilityQuery} from './request-access';
import {assertReadableFile, FileDocument} from './access';
import {applyAttachmentContract} from '../../../utils/attachment-response';
import mongoose, {Types, type HydratedDocument} from 'mongoose';
import logger from '../../../utils/logger';
import {
  commitStorageReservation,
  reconcileStorageUsage,
  releaseStorageReservation,
  reserveStorage,
} from '../billing/storage-quota';

export async function persistUploadedFiles(
  payload: Express.Multer.File[],
  user_id: string,
  clientDuration?: number,
  reservationId?: string,
) {
  const user = await User.findById(user_id);
  if (!user) {
    throw new NotFoundException('User not found');
  }

  const additionalBytes = payload.reduce((acc, f) => acc + f.size, 0);
  const requestFingerprint = createHash('sha256')
    .update(
      payload
        .map(file =>
          [
            file.originalname,
            file.mimetype,
            file.size,
            createHash('sha256').update(file.buffer).digest('hex'),
          ].join(':'),
        )
        .join('|'),
    )
    .digest('hex');
  const reservation = await reserveStorage(
    user_id,
    additionalBytes,
    reservationId,
    requestFingerprint,
  );
  if (!reservation.acquired) {
    if (reservation.status === 'committed' && reservation.file_ids?.length) {
      const existing = await File.find({_id: {$in: reservation.file_ids}});
      return existing;
    }
    throw new ServiceError(
      'Upload is already in progress',
      StatusCodes.CONFLICT,
      {
        code: 'upload_in_progress',
      },
    );
  }

  const files: Awaited<ReturnType<typeof storage.uploadFile>>[] = [];
  const data: HydratedDocument<IFile>[] = [];
  try {
    const uploadResults = await Promise.allSettled(
      payload.map(file => storage.uploadFile(file, user_id, clientDuration)),
    );
    files.push(
      ...uploadResults.flatMap(result =>
        result.status === 'fulfilled' ? [result.value] : [],
      ),
    );
    const failedUpload = uploadResults.find(
      result => result.status === 'rejected',
    );
    if (failedUpload?.status === 'rejected') throw failedUpload.reason;

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        data.splice(0, data.length);
        for (const file of files) {
          const [created] = await File.create([file], {session});
          data.push(created);
        }
        await commitStorageReservation(
          reservation.reservation_id,
          data.reduce((total, file) => total + (file.size || 0), 0),
          data.map(file => file.id),
          session,
        );
      });
    } finally {
      await session.endSession();
    }
  } catch (error) {
    if (data.length) {
      await File.deleteMany({_id: {$in: data.map(file => file.id)}});
    }
    await Promise.all(
      files.flatMap(file => {
        const deletions: Promise<void>[] = [];
        if (file.name && file.type) {
          deletions.push(
            storage
              .deleteFileEverywhere(
                file.name,
                file.provider ?? DEFAULT_STORAGE_PROVIDER,
                file.type,
                false,
              )
              .catch(async cleanupError => {
                logger.error(
                  {key: file.name, err: cleanupError},
                  'Failed to roll back uploaded object; queued cleanup retry',
                );
                await storage.recordStorageCleanupRetry({
                  key: file.name!,
                  user: user_id,
                  type: file.type!,
                  provider: file.provider ?? DEFAULT_STORAGE_PROVIDER,
                });
              }),
          );
        }
        if (file.thumbnail_key) {
          deletions.push(
            storage
              .deleteFileEverywhere(
                file.thumbnail_key,
                DEFAULT_STORAGE_PROVIDER,
                'image/jpeg',
                false,
              )
              .catch(async cleanupError => {
                logger.error(
                  {key: file.thumbnail_key, err: cleanupError},
                  'Failed to roll back derivative; queued cleanup retry',
                );
                await storage.recordStorageCleanupRetry({
                  key: file.thumbnail_key!,
                  user: user_id,
                  type: 'image/jpeg',
                });
              }),
          );
        }
        return deletions;
      }),
    );
    await releaseStorageReservation(reservation.reservation_id);
    throw error;
  }

  await Promise.all(
    data.map(async file => {
      if (
        (file.type?.startsWith('video/') || file.type?.startsWith('audio/')) &&
        file.status === 'processing'
      ) {
        const queued = await queueAttachmentThumbnailProcessing(file.id);
        if (!queued) {
          await File.findByIdAndUpdate(file.id, {
            status: 'failed',
            thumbnail: null,
          });
        }
      }
    }),
  );

  return data;
}

export async function uploadFile(
  payload: Express.Multer.File[],
  userId: string,
  clientDuration?: number,
  reservationId?: string,
) {
  const data = await persistUploadedFiles(
    payload,
    userId,
    clientDuration,
    reservationId,
  );
  return {message: 'File uploaded successfully', data};
}

export async function removeFile(name: string, user_id: string) {
  const file = await File.findActiveOne({name, user: user_id}).select(
    '+backup_at',
  );
  if (!file) {
    throw new NotFoundException('File not found');
  }

  const [memoryReference, capsuleReference, messageReference] =
    await Promise.all([
      Memory.exists({attachments: file.id}),
      Capsule.exists({attachments: file.id}),
      Message.exists({attatchments: file.id}),
    ]);
  if (memoryReference || capsuleReference || messageReference) {
    throw new ServiceError('File is still referenced', StatusCodes.CONFLICT, {
      code: 'file_still_referenced',
    });
  }

  const isBackedUp = !!file.backup_at;

  // Invalidate Redis caches (metadata and chunk buffers)
  try {
    await redis.del(`file-meta:${name}`);
    const keys = await redis.keys(`file-buffer:${name}*`);
    if (keys && keys.length > 0) {
      await Promise.all(keys.map(k => redis.del(k)));
    }
  } catch (redisError) {
    console.error(
      `Error invalidating Redis cache for file ${name}:`,
      redisError,
    );
  }

  if (isBackedUp) {
    await File.updateOne({name}, {$set: {deleted: true}});
  } else {
    await storage.deleteFile(
      file.name,
      file.provider ?? DEFAULT_STORAGE_PROVIDER,
      file.type,
    );
    await File.deleteOne({name});
  }
  await reconcileStorageUsage(user_id);

  return {data: file, message: 'File deleted successfully'};
}

export type ResolvedFileRequest = {
  file: FileDocument;
  key: string;
  type: string;
  variant: FileVariant;
  expiresAt: number | null;
  cacheTtl: number;
};

export async function resolveFileRequest(
  name: string,
  query: Request['query'],
): Promise<ResolvedFileRequest> {
  const capability = parseFileCapabilityQuery(query);

  if (capability === null) {
    const file = await File.findActiveOne({name});
    if (!file) throw new NotFoundException('File not found');
    if (file.access_mode !== 'legacy_public') {
      throw new ForbiddenException('A valid file capability is required');
    }
    logger.warn(
      {fileId: file.id, event: 'compat.files.legacy_bare_url'},
      'Serving a legacy bare file URL during compatibility rollout',
    );
    return {
      file,
      key: file.name,
      type: file.type,
      variant: 'original',
      expiresAt: null,
      cacheTtl: 300,
    };
  }

  if (capability === false) {
    throw new ForbiddenException('Invalid file capability');
  }
  if (!Types.ObjectId.isValid(capability.fid)) {
    throw new ForbiddenException('Invalid file capability');
  }

  const file = await File.findActiveOne({_id: capability.fid});
  if (!file) throw new ForbiddenException('Invalid file capability');
  const expectedKey =
    capability.variant === 'thumbnail' ? file.thumbnail_key : file.name;
  if (!expectedKey || expectedKey !== name) {
    throw new ForbiddenException('Invalid file capability');
  }

  const isValid = verifyFileCapability({
    fileId: file.id,
    objectKey: expectedKey,
    variant: capability.variant,
    exp: capability.exp,
    kid: capability.kid,
    signature: capability.sig,
  });
  if (!isValid) throw new ForbiddenException('Invalid file capability');

  const now = Math.floor(Date.now() / 1000);
  return {
    file,
    key: expectedKey,
    type: capability.variant === 'thumbnail' ? 'image/jpeg' : file.type,
    variant: capability.variant,
    expiresAt: capability.exp,
    cacheTtl: Math.max(0, Math.min(capability.exp - now, 3600)),
  };
}

export async function getResolvedFileMetadata(request: ResolvedFileRequest) {
  const provider = request.file.provider ?? DEFAULT_STORAGE_PROVIDER;
  const result = await storage.getFileMetadata(
    request.key,
    provider,
    request.type,
  );
  const hash = createHash('md5');
  hash.update(`${request.key}-${result.size}`);

  return {
    etag: result.etag || hash.digest('hex'),
    name: request.key,
    type: request.type,
    size: result.size,
    provider,
    updated_at: result.lastModified || new Date(),
  };
}

function parseByteRange(range: string, size: number) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || (!match[1] && !match[2])) {
    throw new ServiceError(
      'Invalid byte range',
      StatusCodes.REQUESTED_RANGE_NOT_SATISFIABLE,
    );
  }

  let start: number;
  let end: number;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  }
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start > end ||
    start >= size
  ) {
    throw new ServiceError(
      'Invalid byte range',
      StatusCodes.REQUESTED_RANGE_NOT_SATISFIABLE,
    );
  }
  return {start, end};
}

export async function getResolvedFileBuffer(
  request: ResolvedFileRequest,
  size: number,
  range?: string,
) {
  let start: number | undefined;
  let end: number | undefined;
  const chunk_size = 0.5 * 1024 * 1024;

  if (range) {
    ({start, end} = parseByteRange(range, size));
  }

  const rangeHeader = range ? `bytes=${start}-${end}` : undefined;
  const fileResponse = await storage.getFile(
    request.key,
    rangeHeader,
    request.file.provider ?? DEFAULT_STORAGE_PROVIDER,
    request.type,
  );

  if (!fileResponse.Body) {
    throw new NotFoundException('File content not found');
  }

  const chunks: Uint8Array[] = [];
  const stream = fileResponse.Body as Readable;

  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  const buffer = Buffer.concat(chunks);

  const data = {buffer, start, end, chunk_size};
  return data;
}

export async function refreshFileAccess(
  fileId: string,
  userId: string,
  context: {memory_id?: string; capsule_id?: string},
) {
  if (context.capsule_id) {
    throw new BadRequestException('Capsule file access is not supported yet');
  }
  const file = await assertReadableFile(fileId, {
    userId,
    memoryId: context.memory_id,
  });
  return {
    message: 'File access refreshed successfully',
    data: applyAttachmentContract(file.toJSON()),
  };
}

export function createFileStream(buffer: Buffer): Readable {
  const stream = new Readable();
  stream.push(buffer);
  stream.push(null);

  return stream;
}

export async function getFiles(payload: IPagination, user_id: string) {
  const {page, limit, ...query} = payload;

  const filters = filterGenerator(query, ['name', 'type']);

  filters.push(
    {user: user_id},
    {provider: {$ne: EXCLUDED_STORAGE_PROVIDER}},
    {deleted: false},
  );

  const data = await File.paginate(
    {$and: filters},
    {
      limit,
      page,
      sort: {created_at: -1, updated_at: -1},
      select: '-base64', // Exclude base64 data from response
    },
  );

  return {message: 'Files retrieved successfully', data};
}
