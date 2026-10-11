import {FilterQuery} from 'mongoose';
import Beneficiary from '../../database/model/beneficiary';
import Group from '../../database/model/group';
import Memory, {IMemory} from '../../database/model/memory';
import User, {IUser} from '../../database/model/user';
import {ensureSharedSpace} from '../../database/model/shared-space';
import File from '../../database/model/file';
import {NotFoundException} from '../../../utils/service-error';
import {serializeAttachmentList} from '../../../utils/attachment-response';

const displayFields =
  '_id first_name last_name picture picture_url deleted disabled';

function display(
  user: Pick<IUser, 'first_name' | 'last_name' | 'picture_url'> & {
    _id: unknown;
  },
) {
  return {
    user_id: String(user._id),
    name:
      [user.first_name, user.last_name].filter(Boolean).join(' ') ||
      'Memento user',
    avatar_url: user.picture_url || null,
  };
}

export async function list(viewerId: string) {
  const relationships = await Beneficiary.find({
    status: 'accepted',
    user: {$ne: null},
    $or: [{benefactor: viewerId}, {user: viewerId}],
  })
    .sort({created_at: 1})
    .lean();
  const ids = [
    ...new Set(
      relationships
        .map(row => (row.benefactor === viewerId ? row.user : row.benefactor))
        .filter(id => id && id !== viewerId),
    ),
  ];
  const users = await User.find({
    _id: {$in: ids},
    deleted: {$ne: true},
    disabled: {$ne: true},
  })
    .select(displayFields)
    .exec();
  const connections = users
    .map(user => {
      const row = relationships.find(
        relation =>
          relation.benefactor === viewerId &&
          relation.user === String(user._id),
      );
      return {
        ...display(user),
        relationship: row?.relationship || null,
        memento_state: 'private' as const,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const invites = await Beneficiary.find({
    benefactor: viewerId,
    status: 'pending',
  })
    .sort({created_at: -1})
    .select('_id name email relationship')
    .lean();
  return {
    connections,
    pending: invites.map(invite => ({
      invite_id: String(invite._id),
      name: invite.name || invite.email,
      email: invite.email,
      relationship: invite.relationship || null,
    })),
  };
}

export async function space(
  personId: string,
  viewerId: string,
  pagination: {page: number; limit: number; filter?: string},
) {
  if (personId === viewerId)
    throw new NotFoundException('Connection not found');
  const relationships = await Beneficiary.find({
    status: 'accepted',
    $or: [
      {benefactor: viewerId, user: personId},
      {benefactor: personId, user: viewerId},
    ],
  }).lean();
  if (!relationships.length)
    throw new NotFoundException('Connection not found');
  const users = await User.find({
    _id: {$in: [personId, viewerId]},
    deleted: {$ne: true},
    disabled: {$ne: true},
  })
    .select(displayFields)
    .exec();
  if (users.length !== 2) throw new NotFoundException('Connection not found');

  const branches: FilterQuery<IMemory>[] = [];
  const provenance = new Map<
    string,
    {beneficiaries: string[]; groups: string[]}
  >();
  for (const ownerId of [viewerId, personId]) {
    const eligible = relationships.filter(
      row =>
        row.benefactor === ownerId &&
        (!row.access_scope ||
          ['full_vault', 'memories_only', 'shared_only'].includes(
            row.access_scope,
          )),
    );
    const beneficiaryIds = eligible.map(row => String(row._id));
    const groups = beneficiaryIds.length
      ? await Group.find({user: ownerId, members: {$in: beneficiaryIds}})
          .select('_id')
          .lean()
      : [];
    const groupIds = groups.map(group => String(group._id));
    provenance.set(ownerId, {beneficiaries: beneficiaryIds, groups: groupIds});
    const sharing: FilterQuery<IMemory>[] = [{visibility: 'everyone'}];
    if (beneficiaryIds.length)
      sharing.push({beneficiaries: {$in: beneficiaryIds}});
    if (groupIds.length) sharing.push({groups: {$in: groupIds}});
    branches.push({user: ownerId, $or: sharing});
  }
  const filter: FilterQuery<IMemory> = {
    type: 'story',
    status: {$in: ['save', 'queued', 'on_chain', 'published']},
    $or: branches,
  };
  const mediaPrefix = {photos: 'image/', voice: 'audio/', videos: 'video/'}[
    pagination.filter as 'photos' | 'voice' | 'videos'
  ];
  if (mediaPrefix) {
    const files = await File.find({
      user: {$in: [viewerId, personId]},
      deleted: {$ne: true},
      type: {$regex: `^${mediaPrefix}`},
    })
      .select('_id')
      .lean();
    filter.attachments = {$in: files.map(file => String(file._id))};
  } else if (pagination.filter === 'notes') {
    // Current source model has stories; direct notes arrive in the next milestone.
    filter._id = {$in: []};
  }
  const [memories, total] = await Promise.all([
    Memory.find(filter)
      .sort({created_at: -1, _id: -1})
      .skip((pagination.page - 1) * pagination.limit)
      .limit(pagination.limit)
      .populate({
        path: 'attachments',
        model: File,
        match: (memory: IMemory) => ({user: memory.user, deleted: {$ne: true}}),
      })
      .exec(),
    Memory.countDocuments(filter),
  ]);
  const shared_space_id = await ensureSharedSpace(viewerId, personId);
  const items = memories.map(memory => {
    const grants = provenance.get(memory.user)!;
    const direct = (memory.beneficiaries || []).some(id =>
      grants.beneficiaries.includes(String(id)),
    );
    const group = (memory.groups || []).some(id =>
      grants.groups.includes(String(id)),
    );
    return {
      source_id: memory.id,
      source_type: 'story' as const,
      title: memory.title || 'Untitled story',
      body: memory.body || '',
      original_date: new Date(memory.created_at).toISOString(),
      contributor: display(
        users.find(user => String(user._id) === memory.user)!,
      ),
      shared_via: direct
        ? 'individual_visibility'
        : group
          ? 'group_visibility'
          : 'everyone_visibility',
      attachments: serializeAttachmentList(memory.attachments),
    };
  });
  return {
    shared_space_id,
    items,
    page: pagination.page,
    total,
    has_next_page: pagination.page * pagination.limit < total,
  };
}
