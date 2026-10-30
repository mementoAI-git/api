import {createHash} from 'node:crypto';
import Message from '../../module/database/model/message';
import {idOf, type SearchMemory} from './source';

export const MAX_CHAT_MESSAGES = 2000;
const MAX_MESSAGE_CHARACTERS = 8000;
const MAX_CHAT_CHARACTERS = 1800 * 128;

/** Read only saved app conversations supplied by the owning-memory query. */
export async function loadChatSources(
  userId: string,
  memories: SearchMemory[],
): Promise<SearchMemory[]> {
  const ids = memories
    .filter(memory => memory.type === 'conversation')
    .map(idOf);
  if (!ids.length) return memories;
  const rows = await Message.aggregate<{
    _id: unknown;
    memory: string;
    text: string;
    role: string;
    updated_at?: Date;
  }>([
    {$match: {user: userId, memory: {$in: ids}}},
    {$sort: {created_at: 1, _id: 1}},
    {$limit: MAX_CHAT_MESSAGES + 1},
    {
      $project: {
        memory: 1,
        role: 1,
        updated_at: 1,
        text: {
          $substrCP: [{$ifNull: ['$text', '']}, 0, MAX_MESSAGE_CHARACTERS + 1],
        },
      },
    },
  ]);
  const overflow = rows.length > MAX_CHAT_MESSAGES;
  const grouped = new Map<string, typeof rows>();
  for (const row of rows) {
    const group = grouped.get(row.memory) || [];
    group.push(row);
    grouped.set(row.memory, group);
  }
  return memories.map(memory => {
    if (memory.type !== 'conversation') return memory;
    const messages = grouped.get(idOf(memory)) || [];
    const text = messages
      .map(message => `${message.role}: ${message.text}`)
      .join('\n');
    return {
      ...memory,
      chat_source: {
        revision: createHash('sha256')
          .update(JSON.stringify(messages))
          .digest('hex'),
        text,
        complete:
          !overflow &&
          text.length <= MAX_CHAT_CHARACTERS &&
          messages.every(
            message => message.text.length <= MAX_MESSAGE_CHARACTERS,
          ),
      },
    };
  });
}
