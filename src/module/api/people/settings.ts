import SharedSpace from '../../database/model/shared-space';
import Beneficiary from '../../database/model/beneficiary';
import User from '../../database/model/user';
import {assertConnection, isPairBlocked} from './connection';
import {space} from './service';
import {NotFoundException} from '../../../utils/service-error';
export const isBlocked = isPairBlocked;
export async function getSettings(personId: string, viewerId: string) {
  const {sharedSpaceId} = await assertConnection(personId, viewerId);
  const archive = await space(personId, viewerId, {page: 1, limit: 1});
  const record = await SharedSpace.findById(sharedSpaceId).lean();
  return {
    relationship: record?.labels?.[viewerId] || null,
    shared_item_count: archive.total,
    privacy:
      'Only memories selected for this relationship are available. Personal Mementos and Talk transcripts remain private.',
  };
}
export async function updateLabel(
  personId: string,
  viewerId: string,
  label: string,
) {
  const {sharedSpaceId} = await assertConnection(personId, viewerId);
  await SharedSpace.updateOne(
    {_id: sharedSpaceId},
    {$set: {[`labels.${viewerId}`]: label}},
  );
  return {relationship: label};
}
export async function disconnect(
  personId: string,
  viewerId: string,
  block: boolean,
) {
  const {sharedSpaceId} = await assertConnection(personId, viewerId);
  await SharedSpace.updateOne(
    {_id: sharedSpaceId},
    {
      $set: {status: 'removed'},
      ...(block ? {$addToSet: {blocked_by: viewerId}} : {}),
    },
  );
  await Beneficiary.updateMany(
    {
      $or: [
        {benefactor: viewerId, user: personId},
        {benefactor: personId, user: viewerId},
      ],
      status: {$in: ['accepted', 'pending']},
    },
    {$set: {status: 'removed'}},
  );
  return {removed: true};
}
export async function blocked(viewerId: string) {
  const pairs = await SharedSpace.find({blocked_by: viewerId}).lean();
  const ids = pairs.map(pair =>
    pair.user_a === viewerId ? pair.user_b : pair.user_a,
  );
  const users = await User.find({_id: {$in: ids}, deleted: {$ne: true}}).select(
    'first_name last_name',
  );
  return users.map(user => ({
    user_id: user.id,
    name:
      [user.first_name, user.last_name].filter(Boolean).join(' ') ||
      'Memento user',
  }));
}
export async function unblock(personId: string, viewerId: string) {
  const pair = await SharedSpace.findOne({
    _id: [viewerId, personId].sort().join(':'),
    blocked_by: viewerId,
  });
  if (!pair) throw new NotFoundException('Blocked connection not found');
  await pair.updateOne({$pull: {blocked_by: viewerId}});
  return {unblocked: true};
}
