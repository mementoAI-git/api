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
  const branches: FilterQuery<IMemory>[] = [
    {
      visibility: 'everyone',
      status: {$nin: ['draft', 'deleted']},
    },
  ];

  if (principal.userId) {
    // Memory owner can access their own memories including drafts (as long as not deleted)
    branches.push({
      user: principal.userId,
      status: {$ne: 'deleted'},
    });

    const beneficiaries = await Beneficiary.find({
      user: principal.userId,
      status: 'accepted',
      $or: [
        {access_scope: {$in: ['full_vault', 'memories_only']}},
        {access_scope: {$exists: false}},
        {access_scope: null},
      ],
    }).select('_id benefactor');

    const beneficiaryIds = beneficiaries.map(b => b.id);
    const benefactorIds = Array.from(
      new Set(
        beneficiaries
          .map(b => (b.benefactor ? String(b.benefactor) : null))
          .filter((id): id is string => Boolean(id)),
      ),
    );

    if (beneficiaryIds.length > 0 && benefactorIds.length > 0) {
      const groups = await Group.find({
        user: {$in: benefactorIds},
        members: {$in: beneficiaryIds},
      }).select('_id');
      const groupIds = groups.map(group => group.id);

      branches.push({
        user: {$in: benefactorIds},
        beneficiaries: {$in: beneficiaryIds},
        status: {$nin: ['draft', 'deleted']},
      });

      if (groupIds.length > 0) {
        branches.push({
          user: {$in: benefactorIds},
          groups: {$in: groupIds},
          status: {$nin: ['draft', 'deleted']},
        });
      }
    }
  }

  return Memory.findOne({
    _id: memoryId,
    $or: branches,
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
