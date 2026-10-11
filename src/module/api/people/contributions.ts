import Memory from '../../database/model/memory';
import File from '../../database/model/file';
import SharedItem, {SHARED_ITEM_TYPES} from '../../database/model/shared-item';
import {assertOwnedFileIds} from '../file/access';
import {assertConnection, ensureRecipient} from './connection';
import {
  BadRequestException,
  NotFoundException,
} from '../../../utils/service-error';
import {space} from './service';

type Kind = (typeof SHARED_ITEM_TYPES)[number];
export async function recordReference(
  personId: string,
  viewerId: string,
  sourceId: string,
  kind: Kind,
  via: 'direct' | 'share_from_memento',
) {
  const {sharedSpaceId} = await assertConnection(personId, viewerId);
  const id = `${sharedSpaceId}:${sourceId}`;
  await SharedItem.updateOne(
    {_id: id, removed_at: {$ne: null}},
    {$set: {shared_at: new Date()}},
  );
  await SharedItem.updateOne(
    {_id: id},
    {
      $setOnInsert: {
        shared_space_id: sharedSpaceId,
        source_id: sourceId,
        contributor_user_id: viewerId,
        kind,
        shared_via: via,
        shared_at: new Date(),
      },
      $set: {removed_at: null},
    },
    {upsert: true},
  );
}
export async function share(
  personId: string,
  viewerId: string,
  sourceId: string,
) {
  await assertConnection(personId, viewerId);
  const memory = await Memory.findOne({
    _id: sourceId,
    user: viewerId,
    type: 'story',
    status: {$in: ['save', 'queued', 'on_chain', 'published']},
  });
  if (!memory) throw new NotFoundException('Memory not found');
  const recipientId = await ensureRecipient(personId, viewerId);
  await Memory.updateOne(
    {_id: sourceId, user: viewerId, status: {$ne: 'deleted'}},
    {$addToSet: {beneficiaries: recipientId}},
  );
  await recordReference(
    personId,
    viewerId,
    sourceId,
    'story',
    'share_from_memento',
  );
  return detail(personId, viewerId, sourceId);
}
export async function contribute(
  personId: string,
  viewerId: string,
  payload: {title: string; body: string; kind: Kind; attachments: string[]},
) {
  await assertConnection(personId, viewerId);
  await assertOwnedFileIds(viewerId, payload.attachments);
  const files = await File.find({
    _id: {$in: payload.attachments},
    user: viewerId,
    deleted: {$ne: true},
  });
  const prefixes = {photo: 'image/', video: 'video/', voice: 'audio/'};
  if (payload.kind === 'note' && !payload.body.trim())
    throw new BadRequestException('Write something first');
  if (
    payload.kind in prefixes &&
    !files.some(file =>
      file.type.startsWith(prefixes[payload.kind as keyof typeof prefixes]),
    )
  )
    throw new BadRequestException('Add the matching media first');
  const recipientId = await ensureRecipient(personId, viewerId);
  const {createMemory} = await import('../memory/service');
  const result = await createMemory(
    {
      title: payload.title,
      body: payload.body,
      attachments: payload.attachments,
      status: 'save',
      level: 1,
      tags: [],
      visibility: 'private',
      beneficiaries: [recipientId],
    },
    viewerId,
  );
  await recordReference(
    personId,
    viewerId,
    result.data.id,
    payload.kind,
    'direct',
  );
  return detail(personId, viewerId, result.data.id);
}
export async function detail(
  personId: string,
  viewerId: string,
  sourceId: string,
) {
  const result = await space(personId, viewerId, {page: 1, limit: 1, sourceId});
  if (!result.items.length)
    throw new NotFoundException('Shared item not found');
  return result.items[0];
}
export async function remove(
  personId: string,
  viewerId: string,
  sourceId: string,
) {
  const item = await detail(personId, viewerId, sourceId);
  if (item.contributor.user_id !== viewerId)
    throw new NotFoundException('Shared item not found');
  if (!item.can_remove)
    throw new BadRequestException(
      'Change the original memory’s group or Everyone sharing settings to remove access',
    );
  const {relationships, sharedSpaceId} = await assertConnection(
    personId,
    viewerId,
  );
  const ids = relationships
    .filter(row => row.benefactor === viewerId)
    .map(row => String(row._id));
  await Memory.updateOne(
    {_id: sourceId, user: viewerId},
    {$pull: {beneficiaries: {$in: ids}}},
  );
  await SharedItem.updateOne(
    {_id: `${sharedSpaceId}:${sourceId}`},
    {$set: {removed_at: new Date()}},
  );
  return {source_id: sourceId};
}
export async function sources(
  viewerId: string,
  query: {page: number; limit: number; search?: string},
) {
  const escaped = (query.search || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const filter = {
    user: viewerId,
    type: 'story',
    status: {$in: ['save', 'queued', 'on_chain', 'published']},
    ...(escaped ? {title: {$regex: escaped, $options: 'i'}} : {}),
  };
  const [docs, total] = await Promise.all([
    Memory.find(filter)
      .select('_id title created_at')
      .sort({created_at: -1, _id: -1})
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean(),
    Memory.countDocuments(filter),
  ]);
  return {
    items: docs.map(row => ({
      source_id: String(row._id),
      title: row.title || 'Untitled story',
      original_date: row.created_at,
    })),
    page: query.page,
    has_next_page: query.page * query.limit < total,
  };
}
