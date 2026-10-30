import {Types} from 'mongoose';
import File from '../../module/database/model/file';
import type {SearchMemory} from './source';
import {idOf} from './source';
import {EXCLUDED_STORAGE_PROVIDER} from '../../utils/constant';

export async function loadSearchPhotos(
  userId: string,
  memories: SearchMemory[],
) {
  const ids = [
    ...new Set(
      memories.flatMap(memory => (memory.attachments || []).map(idOf)),
    ),
  ].filter(id => Types.ObjectId.isValid(id));
  if (!ids.length) return [];
  return File.find({
    _id: {$in: ids},
    user: userId,
    deleted: {$ne: true},
    provider: {$ne: EXCLUDED_STORAGE_PROVIDER},
  })
    .select('_id user name type size provider deleted status updated_at')
    .lean();
}

export function ownerSearchScope(userId: string) {
  return {
    user: userId,
    type: {$in: ['story', 'conversation']},
    status: {$nin: ['draft', 'deleted']},
  };
}
