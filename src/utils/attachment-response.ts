import type {Document} from 'mongoose';
import {signFileUrl} from '../services/storage/file-capability';

export type AttachmentStatus = 'processing' | 'ready' | 'failed';

export interface AttachmentResponse {
  _id: string;
  url: string;
  thumbnail: string | null;
  name: string;
  type: string;
  duration: number | null;
  width: number | null;
  height: number | null;
  size: number | null;
  status: AttachmentStatus;
  access?: {
    expires_at: string;
    refresh_endpoint: string;
  };
}

type AttachmentLike = {
  _id?: unknown;
  id?: unknown;
  url?: unknown;
  backup_url?: unknown;
  thumbnail?: unknown;
  thumbnail_key?: unknown;
  name?: unknown;
  type?: unknown;
  duration?: unknown;
  width?: unknown;
  height?: unknown;
  size?: unknown;
  status?: unknown;
};

function toNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeStatus(value: unknown): AttachmentStatus {
  if (value === 'processing' || value === 'failed' || value === 'ready') {
    return value;
  }
  return 'ready';
}

function normalizeAttachmentInput(input: unknown): AttachmentLike | null {
  if (!input || typeof input !== 'object') {
    return null;
  }

  const candidate = input as Document &
    AttachmentLike & {
      toJSON?: () => Record<string, unknown>;
      toObject?: () => Record<string, unknown>;
    };

  if (typeof candidate.toJSON === 'function') {
    return candidate.toJSON() as AttachmentLike;
  }

  if (typeof candidate.toObject === 'function') {
    return candidate.toObject() as AttachmentLike;
  }

  return candidate;
}

export function serializeAttachment(input: unknown): AttachmentResponse | null {
  const candidate = normalizeAttachmentInput(input);
  if (!candidate) return null;

  const status = normalizeStatus(candidate.status);
  const fileId = String(candidate._id ?? candidate.id ?? '');
  const name = typeof candidate.name === 'string' ? candidate.name : '';
  const signedOriginal =
    fileId && name
      ? signFileUrl({fileId, objectKey: name, variant: 'original'})
      : null;
  const signedThumbnail =
    status === 'ready' &&
    fileId &&
    typeof candidate.thumbnail_key === 'string' &&
    candidate.thumbnail_key
      ? signFileUrl({
          fileId,
          objectKey: candidate.thumbnail_key,
          variant: 'thumbnail',
        })
      : null;
  const thumbnail =
    status === 'ready'
      ? (signedThumbnail?.url ??
        (typeof candidate.thumbnail === 'string' ? candidate.thumbnail : null))
      : null;

  return {
    _id: fileId,
    url:
      signedOriginal?.url ??
      (typeof candidate.url === 'string'
        ? candidate.url
        : typeof candidate.backup_url === 'string'
          ? candidate.backup_url
          : ''),
    thumbnail,
    name,
    type: typeof candidate.type === 'string' ? candidate.type : '',
    duration: toNumberOrNull(candidate.duration),
    width: toNumberOrNull(candidate.width),
    height: toNumberOrNull(candidate.height),
    size: toNumberOrNull(candidate.size),
    status,
    ...(signedOriginal && {
      access: {
        expires_at: signedOriginal.expiresAt,
        refresh_endpoint: `/files/${fileId}/access`,
      },
    }),
  };
}

export function serializeAttachmentList(input: unknown): AttachmentResponse[] {
  if (!Array.isArray(input)) return [];
  return input
    .map(serializeAttachment)
    .filter((item): item is AttachmentResponse => Boolean(item));
}

export function applyAttachmentContract<T extends Record<string, unknown>>(
  input: T,
): T & AttachmentResponse {
  const safeInput: Record<string, unknown> = {...input};
  delete safeInput.backup_url;
  delete safeInput.thumbnail_key;
  const serialized = serializeAttachment(input) || {
    _id: '',
    url: '',
    thumbnail: null,
    name: '',
    type: '',
    duration: null,
    width: null,
    height: null,
    size: null,
    status: 'ready' as AttachmentStatus,
  };

  return {
    ...safeInput,
    ...serialized,
  } as T & AttachmentResponse;
}
