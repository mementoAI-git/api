import {randomUUID} from 'crypto';
import User from '../../database/model/user';
import {
  BadRequestException,
  NotFoundException,
} from '../../../utils/service-error';
export async function get(userId: string) {
  const user = await User.findOne({
    _id: userId,
    deleted: {$ne: true},
    disabled: {$ne: true},
  }).select('connection_memento_state +connection_memento');
  if (!user) throw new NotFoundException('User not found');
  return {
    state: user.connection_memento_state || 'private',
    approved_context: user.connection_memento?.approved_context || '',
    updated_at: user.connection_memento?.updated_at?.toISOString() || null,
  };
}
export async function update(
  userId: string,
  payload: {approved_context: string; active: boolean},
) {
  const context = payload.approved_context.trim();
  if (payload.active && !context)
    throw new BadRequestException(
      'Approve connection-facing context before activating',
    );
  const state = payload.active ? 'active' : context ? 'ready' : 'private';
  const user = await User.findOneAndUpdate(
    {_id: userId, deleted: {$ne: true}, disabled: {$ne: true}},
    {
      $set: {
        connection_memento_state: state,
        connection_memento: {
          approved_context: context,
          revision: randomUUID(),
          updated_at: new Date(),
        },
      },
    },
  );
  if (!user) throw new NotFoundException('User not found');
  return get(userId);
}
