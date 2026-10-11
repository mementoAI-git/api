import {createHash} from 'crypto';
import SharedSpace from '../../database/model/shared-space';
import SharedItem from '../../database/model/shared-item';
import {assertConnection} from './connection';
import {FilterQuery, Types} from 'mongoose';
import Beneficiary from '../../database/model/beneficiary';
import Group from '../../database/model/group';
import Memory, {IMemory} from '../../database/model/memory';
import User, {IUser} from '../../database/model/user';
import File from '../../database/model/file';
import {serializeAttachmentList} from '../../../utils/attachment-response';

const displayFields =
  '_id first_name last_name picture picture_url deleted disabled connection_memento_state';

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
  const spaces = await SharedSpace.find({
    _id: {$in: ids.map(id => [viewerId, id].sort().join(':'))},
  }).lean();
  const unavailable = new Set(
    spaces
      .filter(space => space.status === 'removed' || space.blocked_by?.length)
      .map(space => space._id),
  );
  const users = await User.find({
    _id: {
      $in: ids.filter(id => !unavailable.has([viewerId, id].sort().join(':'))),
    },
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
        relationship:
          spaces.find(
            space =>
              space._id === [viewerId, String(user._id)].sort().join(':'),
          )?.labels?.[viewerId] ||
          row?.relationship ||
          null,
        memento_state: user.connection_memento_state || ('private' as const),
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
  pagination: {
    page: number;
    limit: number;
    filter?: string;
    sourceId?: string;
    sourceIds?: string[];
  },
) {
  const {relationships, users, sharedSpaceId} = await assertConnection(
    personId,
    viewerId,
  );
  const references = await SharedItem.find({
    shared_space_id: sharedSpaceId,
    removed_at: null,
  }).lean();
  const referenceBySource = new Map(
    references.map(row => [row.source_id, row]),
  );

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
  if (pagination.sourceId) filter._id = new Types.ObjectId(pagination.sourceId);
  if (pagination.sourceIds)
    filter._id = {$in: pagination.sourceIds.map(id => new Types.ObjectId(id))};
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
    filter._id = {
      $in: references
        .filter(row => row.kind === 'note')
        .map(row => new Types.ObjectId(row.source_id)),
    };
  }
  if (pagination.filter === 'stories')
    filter._id = {
      $nin: references
        .filter(row => row.kind !== 'story')
        .map(row => new Types.ObjectId(row.source_id)),
    };
  const [ordered, total] = await Promise.all([
    Memory.aggregate<{_id: Types.ObjectId}>([
      {$match: filter},
      {
        $lookup: {
          from: SharedItem.collection.name,
          let: {source: {$toString: '$_id'}},
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    {$eq: ['$source_id', '$$source']},
                    {$eq: ['$shared_space_id', sharedSpaceId]},
                    {$eq: ['$removed_at', null]},
                  ],
                },
              },
            },
          ],
          as: '_shared_reference',
        },
      },
      {
        $addFields: {
          _people_date: {
            $ifNull: [
              {$arrayElemAt: ['$_shared_reference.shared_at', 0]},
              '$created_at',
            ],
          },
        },
      },
      {$sort: {_people_date: -1, _id: -1}},
      {$skip: (pagination.page - 1) * pagination.limit},
      {$limit: pagination.limit},
      {$project: {_id: 1}},
    ]),
    Memory.countDocuments(filter),
  ]);
  const sources = await Memory.find({
    _id: {$in: ordered.map(row => row._id)},
  }).populate({
    path: 'attachments',
    model: File,
    match: (memory: IMemory) => ({user: memory.user, deleted: {$ne: true}}),
  });
  const byId = new Map(sources.map(memory => [memory.id, memory]));
  const memories = ordered
    .map(row => byId.get(String(row._id))!)
    .filter(Boolean);
  const shared_space_id = sharedSpaceId;
  const items = memories.map(memory => {
    const grants = provenance.get(memory.user)!;
    const direct = (memory.beneficiaries || []).some(id =>
      grants.beneficiaries.includes(String(id)),
    );
    const group = (memory.groups || []).some(id =>
      grants.groups.includes(String(id)),
    );
    const reference = referenceBySource.get(memory.id);
    return {
      source_id: memory.id,
      source_revision: createHash('sha256')
        .update(
          JSON.stringify([
            memory.updated_at || memory.created_at,
            memory.attachments.map(file =>
              typeof file === 'string'
                ? file
                : [
                    String((file as {_id?: unknown})._id),
                    file.updated_at,
                    file.transcription?.full_text || '',
                  ],
            ),
          ]),
        )
        .digest('hex'),
      source_type: reference?.kind || ('story' as const),
      shared_date: reference?.shared_at?.toISOString() || null,
      can_remove:
        memory.user === viewerId &&
        direct &&
        !group &&
        memory.visibility !== 'everyone',
      title: memory.title || 'Untitled story',
      body: memory.body || '',
      original_date: new Date(memory.created_at).toISOString(),
      contributor: display(
        users.find(user => String(user._id) === memory.user)!,
      ),
      shared_via: direct
        ? reference?.shared_via || 'individual_visibility'
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
