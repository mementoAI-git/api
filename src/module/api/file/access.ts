import {HydratedDocument, Types} from 'mongoose';
import File, {IFile} from '../../database/model/file';
import {EXCLUDED_STORAGE_PROVIDER} from '../../../utils/constant';
import {NotFoundException} from '../../../utils/service-error';

export type FileDocument = HydratedDocument<IFile>;

export async function assertOwnedFileIds(
  userId: string,
  fileIds: string[],
): Promise<string[]> {
  const uniqueIds = [...new Set(fileIds.map(String))];
  if (uniqueIds.length === 0) return [];
  if (uniqueIds.some(fileId => !Types.ObjectId.isValid(fileId))) {
    throw new NotFoundException('File not found');
  }

  const owned = await File.find({
    _id: {$in: uniqueIds},
    user: userId,
    deleted: {$ne: true},
    provider: {$ne: EXCLUDED_STORAGE_PROVIDER},
  }).select('_id');

  if (owned.length !== uniqueIds.length) {
    throw new NotFoundException('File not found');
  }
  return uniqueIds;
}
