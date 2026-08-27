import {FilterQuery, HydratedDocument} from 'mongoose';
import Beneficiary from '../../database/model/beneficiary';
import Group from '../../database/model/group';
import Memory, {IMemory} from '../../database/model/memory';
import {NotFoundException} from '../../../utils/service-error';

export type MemoryPrincipal = {userId?: string};
export type MemoryDocument = HydratedDocument<IMemory>;

export async function findReadableMemory(
  memoryId: string,
  principal: MemoryPrincipal,
): Promise<MemoryDocument | null> {
  const accessBranches: FilterQuery<IMemory>[] = [{visibility: 'everyone'}];

  if (principal.userId) {
    const beneficiaries = await Beneficiary.find({
      user: principal.userId,
      status: 'accepted',
    }).select('_id');
    const beneficiaryIds = beneficiaries.map(beneficiary => beneficiary.id);
    const groups = await Group.find({members: {$in: beneficiaryIds}}).select(
      '_id',
    );
    const groupIds = groups.map(group => group.id);

    accessBranches.push(
      {user: principal.userId},
      {beneficiaries: {$in: beneficiaryIds}},
      {groups: {$in: groupIds}},
    );
  }

  return Memory.findOne({
    _id: memoryId,
    status: {$nin: ['draft', 'deleted']},
    $or: accessBranches,
  });
}

export function findOwnedMemory(
  memoryId: string,
  userId: string,
): Promise<MemoryDocument | null> {
  return Memory.findOne({_id: memoryId, user: userId});
}

export async function assertReadableMemory(
  memoryId: string,
  principal: MemoryPrincipal,
): Promise<MemoryDocument> {
  const memory = await findReadableMemory(memoryId, principal);
  if (!memory) throw new NotFoundException('Memory not found');
  return memory;
}

export async function assertOwnedMemory(
  memoryId: string,
  userId: string,
): Promise<MemoryDocument> {
  const memory = await findOwnedMemory(memoryId, userId);
  if (!memory) throw new NotFoundException('Memory not found');
  return memory;
}
