import {Response, Request} from 'express';
import {check, validationResult} from 'express-validator';
import bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import {ec} from 'elliptic';
import {
  SessionTimeout,
  UnauthorizedException,
  UnprocessableContent,
} from './service-error';
import {JWT_SECRET} from './config';
import {IPagination} from './interface';
import dayjs from 'dayjs';
import {FilterQuery} from 'mongoose';
import {writeFile, unlink} from 'fs/promises';
import {extname, join} from 'path';
import {tmpdir} from 'os';
import {getAudioDurationInSeconds} from 'get-audio-duration';
import mongoose from '../module/database/connection';
import {SENSITIVE_FIELDS, SUPPORTED_FILE_TYPES} from './constant';
import {ClientSession} from 'mongoose';
import {randomUUID} from 'crypto';
import {
  CONTRACT_VERSION,
  defaultErrorCode,
  type ApiError,
  type ApiResponse,
  type ErrorCode,
  type RequestContext,
} from '../contracts/response';
import type {SessionClaims} from '../contracts/session';

type NewSessionClaims = Pick<SessionClaims, 'sid' | 'sv'>;

export const random = (len = 6, type: 'number' | 'alphanumeric' = 'number') => {
  if (type === 'number') {
    const min = 10 ** (len - 1);
    const max = 10 ** len - 1;
    return Math.floor(Math.random() * (max - min + 1) + min).toString();
  }

  const characters = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < len; i++) {
    const index = Math.floor(Math.random() * characters.length);
    code += characters[index];
  }
  return code;
};

export const isEmpty = (mixedVar: any) => {
  let undef;
  let key;
  let i;
  let len;
  const emptyValues = [undef, null, false, 0, '', '0', 'null', 'undefined'];

  for (i = 0, len = emptyValues.length; i < len; i++) {
    if (mixedVar === emptyValues[i] || typeof mixedVar === 'undefined') {
      return true;
    }
  }

  if (typeof mixedVar === 'object' && !(mixedVar instanceof Date)) {
    for (key in mixedVar) {
      if (Object.prototype.hasOwnProperty.call(mixedVar, key)) {
        return false;
      }
    }
    return true;
  }
  return false;
};

export const getStringSize = (str: string, format = 'base64') => {
  if (format === 'base64') {
    const padding = str.endsWith('==') ? 2 : str.endsWith('=') ? 1 : 0;
    return str.length * (3 / 4) - padding;
  }
  return Buffer.byteLength(str, 'utf8');
};

export const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'] as const;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const unit = units[Math.min(i, units.length - 1)];
  const value = bytes / Math.pow(k, Math.min(i, units.length - 1));
  const decimals = value >= 100 ? 0 : value >= 1 ? 1 : 1;
  return `${value.toFixed(decimals)}${unit}`;
};

export const compareStrings = (str1: string, str2: string) => {
  return str1?.toLowerCase().trim() === str2?.toLowerCase().trim();
};

export const responsHandler = (
  res: Response,
  status: number,
  message: string,
  data: any = null,
  options: {deprecations?: string[]} = {},
) => {
  const context = res.locals.requestContext as RequestContext | undefined;
  const requestId = context?.requestId || randomUUID();
  if (!res.getHeader('X-Request-Id')) res.setHeader('X-Request-Id', requestId);
  const response: ApiResponse<unknown> = {
    status,
    success: true,
    message,
    data,
    meta: {
      contract_version: CONTRACT_VERSION,
      request_id: requestId,
      ...(options.deprecations?.length
        ? {deprecations: options.deprecations}
        : {}),
    },
  };
  res.status(status).json(response);
};

export const errorResponsHandler = (
  res: Response,
  status: number,
  message: string,
  options: {
    code?: ErrorCode;
    data?: unknown;
    topLevel?: Record<string, unknown>;
  } = {},
) => {
  const context = res.locals.requestContext as RequestContext | undefined;
  const requestId = context?.requestId || randomUUID();
  if (!res.getHeader('X-Request-Id')) res.setHeader('X-Request-Id', requestId);

  const data = options.data ?? null;
  const details = Array.isArray(data)
    ? {errors: data}
    : data && typeof data === 'object'
      ? (data as Record<string, unknown>)
      : undefined;
  const response: ApiError & {
    data: unknown;
    [key: string]: unknown;
  } = {
    status,
    success: false,
    message,
    code: options.code ?? defaultErrorCode(status),
    request_id: requestId,
    ...(details ? {details} : {}),
    ...(options.topLevel || {}),
    data,
  };

  return res.status(status).json(response);
};

export const validateRequest = (req: Request) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const message = errors.array()[0].msg;
    throw new UnprocessableContent(message, errors.array());
  }
};

/** MIME type without parameters (e.g. `codecs=`), lowercased — matches browser `MediaRecorder` types like `audio/webm;codecs=opus`. */
export function uploadMimeBaseType(mimetype: string): string {
  return mimetype.split(';')[0]!.trim().toLowerCase();
}

/** When Safari/mobile send `application/octet-stream` or an empty type for M4A/MP4 blobs, infer from filename. Keys must stay in sync with `SUPPORTED_FILE_TYPES`. */
const UPLOAD_EXT_FALLBACK: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.heic': 'image/heic',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx':
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.txt': 'text/plain',
  '.mp4': 'video/mp4',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.mpeg': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
};

const allowedUploadMimeSet = new Set<string>(SUPPORTED_FILE_TYPES);

/**
 * Effective MIME for validation and storage. Fixes octet-stream / missing types from mobile recorders.
 */
export function resolveUploadMime(file: {
  mimetype: string;
  originalname: string;
}): string {
  const base = uploadMimeBaseType(file.mimetype);
  if (
    base &&
    base !== 'application/octet-stream' &&
    allowedUploadMimeSet.has(base)
  ) {
    return base;
  }
  const ext = extname(file.originalname || '').toLowerCase();
  const fromExt = UPLOAD_EXT_FALLBACK[ext];
  if (fromExt && allowedUploadMimeSet.has(fromExt)) {
    return fromExt;
  }
  return base;
}

export const getFiles = (
  req: Request,
  required = false,
): Express.Multer.File[] => {
  const files = req.files as unknown as Express.Multer.File[] | undefined;

  if (required && (!files || files.length === 0)) {
    throw new UnprocessableContent('Upload a file');
  }

  if (!files) return [];

  const allowedTypes = allowedUploadMimeSet;
  if (files.some(f => !allowedTypes.has(resolveUploadMime(f)))) {
    throw new UnprocessableContent(
      'Invalid file type. Supported types: PNG, JPEG, HEIC, PDF, Word (.doc, .docx), plain text, MP4, WebM, QuickTime, AVI videos, and common audio formats (MP3, WAV, OGG, AAC, FLAC, WebM).',
    );
  }

  return files;
};

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const MAX_PAGE_NUMBER = 10_000;

function boundedPositiveInteger(
  value: unknown,
  fallback: number,
  maximum: number,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(maximum, Math.floor(parsed));
}

export const getPagination = (req: Request): IPagination => {
  const {limit = DEFAULT_PAGE_SIZE, page = 1} = req.query;

  return {
    ...req.query,
    limit: boundedPositiveInteger(limit, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE),
    page: boundedPositiveInteger(page, 1, MAX_PAGE_NUMBER),
  };
};

export const hashPassword = async (password: string) => {
  const salt = await bcrypt.genSalt(10);
  return await bcrypt.hash(password, salt);
};

export const generateKeys = () => {
  const EC = new ec('secp256k1');
  const key = EC.genKeyPair();

  const private_key = key.getPrivate('hex');
  const public_key = key.getPublic('hex');

  return {private_key, public_key};
};

export const createAccessToken = (
  id: string,
  expires_in = 24 * 60 * 60 * 1000,
  claims: NewSessionClaims = {},
) => {
  const access_token = jwt.sign({id, ...claims}, String(JWT_SECRET), {
    audience: 'API',
    issuer: 'Memento',
    expiresIn: expires_in,
  });

  const expires_at = dayjs().add(expires_in, 'millisecond').toISOString();
  return {access_token, expires_at};
};

export const createRefreshToken = (
  id: string,
  expires_in = 30 * 24 * 60 * 60 * 1000,
  claims: NewSessionClaims = {},
) => {
  const refresh_token = jwt.sign(
    {id, ...claims, type: 'refresh'},
    String(JWT_SECRET),
    {
      audience: 'API',
      issuer: 'Memento',
      expiresIn: expires_in,
      jwtid: randomUUID(),
    },
  );

  const expires_at = dayjs().add(expires_in, 'millisecond').toISOString();
  return {refresh_token, expires_at};
};

export const createTokenPair = (
  id: string,
  accessExpiresIn = 24 * 60 * 60 * 1000,
  refreshExpiresIn = 30 * 24 * 60 * 60 * 1000,
  claims: NewSessionClaims = {},
) => {
  const accessToken = createAccessToken(id, accessExpiresIn, claims);
  const refreshToken = createRefreshToken(id, refreshExpiresIn, claims);

  return {
    access_token: accessToken.access_token,
    refresh_token: refreshToken.refresh_token,
    access_expires_at: accessToken.expires_at,
    expires_at: accessToken.expires_at,
    refresh_expires_at: refreshToken.expires_at,
  };
};

export const reconstructFileName = (name: string) => {
  const file_name = name.toLowerCase().replace(/\s+/g, '_');
  const extension = name.split('.').pop();
  const timestamp = dayjs().format('YYMMDDHHmmss');

  return `${file_name.replace(/\.[^/.]+$/, '')}_${timestamp}.${extension}`.toLowerCase();
};

export const verifyAccessToken = (token: string): SessionClaims => {
  try {
    return jwt.verify(token, String(JWT_SECRET), {
      audience: 'API',
      issuer: 'Memento',
    }) as SessionClaims;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) throw new SessionTimeout();
    throw new UnauthorizedException();
  }
};

export const verifyRefreshToken = (token: string): SessionClaims => {
  let decoded: SessionClaims;
  try {
    decoded = jwt.verify(token, String(JWT_SECRET), {
      audience: 'API',
      issuer: 'Memento',
    }) as SessionClaims;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) throw new SessionTimeout();
    throw new UnauthorizedException();
  }
  if (decoded.type !== 'refresh') {
    throw new UnauthorizedException('Invalid token type');
  }
  return decoded;
};

export const filterGenerator = (payload: object, fields: string[] = []) => {
  const proccessed: FilterQuery<any>[] = [];
  const queries = Object.entries(payload);
  const allowed = fields.concat(['search']);

  for (let i = 0; i < queries.length; i++) {
    if (!allowed.includes(queries[i][0])) continue;
    if (queries[i][0] === 'search' && !isEmpty(queries[i][1])) {
      const escapedSearch = String(queries[i][1])
        .slice(0, 256)
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const search_filters: any[] = fields.map(key => ({
        [key]: {$regex: new RegExp(escapedSearch), $options: 'i'},
      }));
      proccessed.push({$or: search_filters});
    } else proccessed.push({[queries[i][0]]: queries[i][1]});
  }

  return proccessed;
};

export const getTimeBasedGreeting = (): string => {
  const hour = dayjs().hour();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
};

export const emptyPaginatedList = ({limit, page}) => {
  return {
    docs: [],
    totalDocs: 0,
    limit,
    page,
    totalPages: 0,
    hasNextPage: false,
    hasPrevPage: false,
    nextPage: null,
    prevPage: null,
  };
};

export const extractJson = (text: string) => {
  try {
    let cleanedResponse = text.trim();
    if (cleanedResponse.startsWith('```json')) {
      cleanedResponse = cleanedResponse
        .replace(/^```json\s*/, '')
        .replace(/\s*```$/, '');
    } else if (cleanedResponse.startsWith('```')) {
      cleanedResponse = cleanedResponse
        .replace(/^```\s*/, '')
        .replace(/\s*```$/, '');
    }

    const jsonMatch = cleanedResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      cleanedResponse = jsonMatch[0];
    }
    return JSON.parse(cleanedResponse);
  } catch (error) {
    return null;
  }
};

export async function getMediaDuration(
  base64Data: string,
  mimetype: string,
): Promise<number | undefined> {
  const is_media_file =
    mimetype.startsWith('audio/') || mimetype.startsWith('video/');
  if (!is_media_file) return null;

  let tempFilePath: string | null = null;

  try {
    const buffer = Buffer.from(base64Data, 'base64');

    const tempFileName = `temp_media_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    tempFilePath = join(tmpdir(), tempFileName);

    // Write buffer to temporary file
    await writeFile(tempFilePath, buffer);

    // Get duration using the file path
    const duration = await getAudioDurationInSeconds(tempFilePath);
    return duration; // Round to 2 decimal places
  } catch (error) {
    return null;
  } finally {
    if (tempFilePath) {
      try {
        await unlink(tempFilePath);
      } catch (cleanupError) {
        console.error('Error cleaning up temporary file:', cleanupError);
      }
    }
  }
}

export const concatStrings = (...args: any[]): string => {
  if (args.length === 0) return '';

  const separator = args[args.length - 1];
  const strings = args.slice(0, -1);

  return strings
    .filter(str => str && typeof str === 'string' && str.trim() !== '')
    .join(separator || '');
};

export const idValidator = check('id')
  .notEmpty()
  .withMessage('Id is required')
  .isMongoId()
  .withMessage('Invalid id ');

export const parseJson = (text: string) => {
  try {
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
};

export const sanitizeData = (data: any): any => {
  if (!data || typeof data !== 'object') {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map(item => sanitizeData(item));
  }

  const sanitized: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    const lowerKey = key.toLowerCase();

    // Check if this field should be censored (case-insensitive)
    if (
      SENSITIVE_FIELDS.some(field => lowerKey.includes(field.toLowerCase()))
    ) {
      sanitized[key] = 'XXX';
    } else if (typeof value === 'object' && value !== null) {
      // Recursively sanitize nested objects
      sanitized[key] = sanitizeData(value);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
};

export async function withTransaction<T>(
  callback: (session: ClientSession) => Promise<T>,
): Promise<T> {
  const session = await mongoose.startSession();
  let result: T | undefined;

  try {
    const isReplicaSet = Boolean(
      (mongoose.connection as any)?.client?.topology?.description?.setName,
    );
    if (!isReplicaSet) {
      return await callback(session);
    }
    await session.withTransaction(async () => {
      result = await callback(session);
    });
    return result as T;
  } finally {
    await session.endSession();
  }
}

export const generateDefaultAvatarUrl = (seed?: string): string => {
  const normalized = (seed || 'memento').trim().toLowerCase();
  return `https://api.dicebear.com/9.x/adventurer/png?seed=${encodeURIComponent(normalized)}&backgroundColor=fefbf8`;
};
