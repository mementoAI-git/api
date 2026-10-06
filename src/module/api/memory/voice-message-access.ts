import {assertOwnedMemory} from './access';
import {assertOwnedFileIds} from '../file/access';
import type {IAddMessageToMemory} from './interface';

export async function checkVoiceMessageAccess(
  payload: IAddMessageToMemory,
  userId: string,
) {
  const memory = payload.memory_id
    ? await assertOwnedMemory(payload.memory_id, userId)
    : null;
  const attachmentIds = await assertOwnedFileIds(
    userId,
    payload.messages.flatMap(message => message.attachments || []),
  );
  return {memory, attachmentIds};
}
