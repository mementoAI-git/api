import SharedSpace from '../../database/model/shared-space';
import Beneficiary, {
  BeneficiaryAccessScope,
} from '../../database/model/beneficiary';
import Group from '../../database/model/group';
import File from '../../database/model/file';
import {serializeAttachmentList} from '../../../utils/attachment-response';
import {reconcileUsageCounts} from '../billing/usage-accounting';
import {forgetUserContext} from '../../../services/user-context-cache';
import User from '../../database/model/user';
import {assertConnection, isPairBlocked, ensureRecipient} from './connection';
import {space} from './service';
import {
  NotFoundException,
  BadRequestException,
} from '../../../utils/service-error';
export const isBlocked = isPairBlocked;
export async function getSettings(personId: string, viewerId: string) {
  const {sharedSpaceId} = await assertConnection(personId, viewerId);
  const archive = await space(personId, viewerId, {page: 1, limit: 1});
  const record = await SharedSpace.findById(sharedSpaceId).lean();
  const beneficiary = await Beneficiary.findOne({
    benefactor: viewerId,
    user: personId,
    status: 'accepted',
  }).lean();
  const groups = beneficiary
    ? await Group.find({user: viewerId, members: String(beneficiary._id)})
        .select('_id name color')
        .lean()
    : [];
  const avatar = beneficiary?.avatar_file_id
    ? await File.findOne({
        _id: beneficiary.avatar_file_id,
        user: viewerId,
        deleted: {$ne: true},
      })
    : null;
  const attachments = avatar ? await serializeAttachmentList([avatar]) : [];
  return {
    email:
      beneficiary?.email ||
      (await User.findById(personId).select('email'))?.email ||
      '',
    about: beneficiary?.about || '',
    access_scope:
      beneficiary?.access_scope || (beneficiary ? 'full_vault' : 'shared_only'),
    avatar_file_id: beneficiary?.avatar_file_id || null,
    avatar_url: attachments[0]?.url || null,
    groups: groups.map(group => ({
      id: String(group._id),
      name: group.name,
      color: group.color,
      source: 'group' as const,
    })),
    relationship:
      record?.labels?.[viewerId] || beneficiary?.relationship || null,
    display_name:
      record?.display_names?.[viewerId] || beneficiary?.name || null,
    shared_item_count: archive.total,
    privacy:
      'Only memories selected for this relationship are available. Personal Mementos and Talk transcripts remain private.',
  };
}
export interface ConnectionMetadata {
  about?: string;
  group_ids?: string[];
  access_scope?: BeneficiaryAccessScope;
  avatar_file_id?: string | null;
}
export async function updateLabel(
  personId: string,
  viewerId: string,
  label: string,
  displayName?: string,
  metadata: ConnectionMetadata = {},
) {
  const {sharedSpaceId} = await assertConnection(personId, viewerId);
  const groupIds =
    metadata.group_ids === undefined
      ? undefined
      : [...new Set(metadata.group_ids)];
  if (
    groupIds &&
    (await Group.countDocuments({_id: {$in: groupIds}, user: viewerId})) !==
      groupIds.length
  )
    throw new BadRequestException('Group not found');
  if (
    metadata.avatar_file_id &&
    !(await File.exists({
      _id: metadata.avatar_file_id,
      user: viewerId,
      deleted: {$ne: true},
      type: /^image\//,
    }))
  )
    throw new BadRequestException('Choose one of your uploaded photos');
  let beneficiary = await Beneficiary.findOne({
    benefactor: viewerId,
    user: personId,
    status: 'accepted',
  });
  if (!beneficiary && Object.keys(metadata).length) {
    const id = await ensureRecipient(personId, viewerId);
    beneficiary = await Beneficiary.findById(id);
  }
  if (beneficiary) {
    beneficiary.relationship = label;
    if (displayName !== undefined) beneficiary.name = displayName;
    if (metadata.about !== undefined) beneficiary.about = metadata.about;
    if (metadata.access_scope !== undefined)
      beneficiary.access_scope = metadata.access_scope;
    if (metadata.avatar_file_id !== undefined)
      beneficiary.avatar_file_id = metadata.avatar_file_id;
    await beneficiary.save();
    if (groupIds !== undefined) {
      await Group.updateMany(
        {user: viewerId, members: beneficiary.id, _id: {$nin: groupIds}},
        {$pull: {members: beneficiary.id}},
      );
      await Group.updateMany(
        {user: viewerId, _id: {$in: groupIds}},
        {$addToSet: {members: beneficiary.id}},
      );
    }
  }
  await SharedSpace.updateOne(
    {_id: sharedSpaceId},
    {
      $set: {
        [`labels.${viewerId}`]: label,
        ...(displayName !== undefined
          ? {[`display_names.${viewerId}`]: displayName}
          : {}),
      },
    },
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
  // Legacy lists and quotas must agree with the People removal state.
  const removed = await Beneficiary.find({
    status: 'removed',
    $or: [
      {benefactor: viewerId, user: personId},
      {benefactor: personId, user: viewerId},
    ],
  }).select('_id');
  await Group.updateMany(
    {user: {$in: [viewerId, personId]}},
    {$pull: {members: {$in: removed.map(row => row.id)}}},
  );
  await Promise.all([
    reconcileUsageCounts(viewerId),
    reconcileUsageCounts(personId),
  ]);
  void forgetUserContext(viewerId);
  void forgetUserContext(personId);
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
