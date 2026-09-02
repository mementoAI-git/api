import {HydratedDocument} from 'mongoose';
import {
  serializeAttachmentList,
  AttachmentResponse,
} from '../../../utils/attachment-response';
import {IMemory} from '../../database/model/memory';

export interface PublicMemory {
  _id: string;
  title: string;
  body: string;
  tags: string[];
  created_at: string;
  attachments: AttachmentResponse[];
}

export function toPublicMemory(
  memory: HydratedDocument<IMemory>,
): PublicMemory {
  return {
    _id: memory.id,
    title: memory.title,
    body: memory.body,
    tags: memory.tags || [],
    created_at: new Date(memory.created_at).toISOString(),
    attachments: serializeAttachmentList(memory.attachments),
  };
}
