import {createHash} from 'crypto';
import Beneficiary from '../../database/model/beneficiary';
import User from '../../database/model/user';
import SharedSpace, {
  ensureSharedSpace,
} from '../../database/model/shared-space';
import {NotFoundException} from '../../../utils/service-error';

export async function assertConnection(personId: string, viewerId: string) {
  if (personId === viewerId)
    throw new NotFoundException('Connection not found');
  const current = await SharedSpace.findById(
    [viewerId, personId].sort().join(':'),
  );
  if (current?.status === 'removed' || current?.blocked_by?.length)
    throw new NotFoundException('Connection not found');
  const relationships = await Beneficiary.find({
    status: 'accepted',
    $or: [
      {benefactor: viewerId, user: personId},
      {benefactor: personId, user: viewerId},
    ],
  }).lean();
  const users = await User.find({
    _id: {$in: [viewerId, personId]},
    deleted: {$ne: true},
    disabled: {$ne: true},
  });
  if (!relationships.length || users.length !== 2)
    throw new NotFoundException('Connection not found');
  return {
    relationships,
    users,
    sharedSpaceId: await ensureSharedSpace(viewerId, personId),
  };
}

export async function ensureRecipient(personId: string, viewerId: string) {
  const {users} = await assertConnection(personId, viewerId);
  const accepted = await Beneficiary.findOne({
    benefactor: viewerId,
    user: personId,
    status: 'accepted',
    access_scope: {$in: ['full_vault', 'memories_only', 'shared_only']},
  });
  if (accepted) return accepted.id;
  const person = users.find(user => user.id === personId)!;
  // Stable primary key avoids duplicate reciprocal grants during concurrent shares.
  const id = createHash('sha256')
    .update(`people-recipient:${viewerId}:${personId}`)
    .digest('hex')
    .slice(0, 24);
  await Beneficiary.updateOne(
    {_id: id},
    {
      $set: {status: 'accepted'},
      $setOnInsert: {
        benefactor: viewerId,
        user: personId,
        email: person.email,
        name: [person.first_name, person.last_name].filter(Boolean).join(' '),
        relationship: 'Connection',
        access_scope: 'shared_only',
        accepted_at: new Date(),
      },
    },
    {upsert: true},
  );
  return id;
}

export async function isPairBlocked(firstId: string, secondId: string) {
  const space = await SharedSpace.findById(
    [firstId, secondId].sort().join(':'),
  ).select('blocked_by');
  return Boolean(space?.blocked_by?.length);
}
export async function activatePair(firstId: string, secondId: string) {
  if (await isPairBlocked(firstId, secondId))
    throw new NotFoundException('Connection not available');
  const id = await ensureSharedSpace(firstId, secondId);
  await SharedSpace.updateOne(
    {_id: id, blocked_by: {$size: 0}},
    {$set: {status: 'active'}},
  );
}
