import {HydratedDocument, Types} from 'mongoose';
import File, {IFile} from '../../database/model/file';
import {EXCLUDED_STORAGE_PROVIDER} from '../../../utils/constant';
import {NotFoundException} from '../../../utils/service-error';
import {assertReadableMemory} from '../memory/access';

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

export async function assertReadableFile(
  fileId: string,
  principal: {userId: string; memoryId?: string},
): Promise<FileDocument> {
  if (!Types.ObjectId.isValid(fileId)) {
    throw new NotFoundException('File not found');
  }

  const file = await File.findOne({
    _id: fileId,
    deleted: {$ne: true},
    provider: {$ne: EXCLUDED_STORAGE_PROVIDER},
  });
  if (!file) throw new NotFoundException('File not found');

  if (String(file.user) === principal.userId) return file;
  if (!principal.memoryId || !Types.ObjectId.isValid(principal.memoryId)) {
    throw new NotFoundException('File not found');
  }

  const memory = await assertReadableMemory(principal.memoryId, {
    userId: principal.userId,
  });
  const referencesFile = memory.attachments.some(
    attachment => String(attachment) === file.id,
  );
  if (!referencesFile) throw new NotFoundException('File not found');

  return file;
}
