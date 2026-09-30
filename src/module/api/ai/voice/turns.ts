import Memory from '../../../database/model/memory';
import Message from '../../../database/model/message';
import {assertOwnedMemory} from '../../memory/access';
import {updateStreak} from '../../user/service';
import {addToInsightsBuffer} from '../../../../services/queues/insights';
import {isSignificantMessage, updateMemoryTitle} from '../utils';

export type VoiceTurnInput = {
  index: number;
  role: 'user' | 'ai';
  text: string;
  interrupted?: boolean;
};

export type RecordVoiceTurnsPayload = {
  session_id: string;
  memory_id?: string;
  turns: VoiceTurnInput[];
};

async function resolveConversation(
  userId: string,
  payload: RecordVoiceTurnsPayload,
) {
  if (payload.memory_id) return assertOwnedMemory(payload.memory_id, userId);
  const existing = await Memory.findOne({
    user: userId,
    session_id: payload.session_id,
  });
  if (existing) return existing;
  return Memory.create({
    user: userId,
    title: null,
    type: 'conversation',
    status: 'save',
    session_id: payload.session_id,
  });
}

async function findUserTextBefore(
  memoryId: string,
  sessionId: string,
  index: number,
  batch: VoiceTurnInput[],
): Promise<string | undefined> {
  const inBatch = batch.find(
    turn => turn.index === index - 1 && turn.role === 'user',
  );
  if (inBatch) return inBatch.text;
  const stored = await Message.findOne({
    memory: memoryId,
    voice_session_id: sessionId,
    voice_turn_index: index - 1,
    role: 'user',
  })
    .select('text')
    .lean();
  return stored?.text;
}

export async function recordVoiceTurns(
  userId: string,
  payload: RecordVoiceTurnsPayload,
) {
  const memory = await resolveConversation(userId, payload);
  const memoryId = String(memory._id);
  const turns = [...payload.turns].sort((a, b) => a.index - b.index);
  const now = new Date();

  const insertedTurns: VoiceTurnInput[] = [];
  for (const turn of turns) {
    const result = await Message.updateOne(
      {
        memory: memoryId,
        voice_session_id: payload.session_id,
        voice_turn_index: turn.index,
      },
      {
        $setOnInsert: {
          user: userId,
          memory: memoryId,
          role: turn.role,
          text: turn.text,
          is_voice: true,
          duration: 0,
          voice_session_id: payload.session_id,
          voice_turn_index: turn.index,
          voice_interrupted: turn.interrupted || undefined,
        },
      },
      {upsert: true},
    );
    if (result.upsertedCount > 0) insertedTurns.push(turn);
  }

  if (insertedTurns.length > 0) {
    await Memory.updateOne(
      {_id: memoryId},
      {
        $inc: {message_count: insertedTurns.length},
        $set: {last_active: now},
      },
    );
    void updateStreak(userId).catch(error =>
      console.error('Error updating voice streak:', error),
    );

    for (const turn of insertedTurns) {
      if (turn.role !== 'ai') continue;
      const userText = await findUserTextBefore(
        memoryId,
        payload.session_id,
        turn.index,
        turns,
      );
      if (userText && isSignificantMessage(userText)) {
        addToInsightsBuffer(userId, memoryId, userText, turn.text).catch(
          error => console.error('Error queueing voice insights:', error),
        );
      }
    }

    if (!memory.title) {
      const firstUser = turns.find(turn => turn.role === 'user');
      const firstAi = turns.find(turn => turn.role === 'ai');
      if (firstUser && firstAi) {
        void updateMemoryTitle(memoryId, firstUser.text, firstAi.text);
      }
    }
  }

  return {
    message: 'Voice turns recorded',
    data: {
      memory_id: memoryId,
      inserted: insertedTurns.length,
      duplicates: turns.length - insertedTurns.length,
    },
  };
}
