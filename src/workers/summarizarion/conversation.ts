import {prompts} from '../../utils';
import ai from '../../services/ai';
import {extractJson} from '../../utils/helpers';
import Memory from '../../module/database/model/memory';
import Message from '../../module/database/model/message';
import logger from '../../utils/logger';
import dayjs from 'dayjs';
import summarizeStory from './story';

const INACTIVITY_MINUTES = 10;
const MIN_MESSAGES_FOR_INACTIVE_SUMMARY = 2; // Lower threshold for inactive conversations
const BATCH_SIZE = 50;

export async function summarizeConversation(memoryId: string): Promise<void> {
  try {
    const messages = await Message.find({memory: memoryId})
      .sort({created_at: 1})
      .select('role text created_at');

    if (messages.length < MIN_MESSAGES_FOR_INACTIVE_SUMMARY) {
      return;
    }

    const conversationText = messages
      .map(m => `${m.role === 'user' ? 'User' : 'AI'}: ${m.text}`)
      .join('\n\n');

    const prompt = prompts.buildSummarizationPrompt();

    const response = await ai.generateText([
      {role: 'user', content: `${prompt}\n\n${conversationText}`},
    ]);

    const result = extractJson(response);
    if (result) {
      await Memory.findByIdAndUpdate(memoryId, {
        summary: result?.summary || '',
        topics: result?.topics || [],
        last_summarized_at: new Date(),
      });
    }

    logger.debug(`Generated summary for memory ${memoryId}`);
  } catch (error) {
    logger.error(error, 'Error generating conversation summary');
  }
}

// This summarizes inactive conversations
export default async function summarizeAllMemories(): Promise<string> {
  try {
    const inactivityThreshold = dayjs()
      .subtract(INACTIVITY_MINUTES, 'minute')
      .toDate();

    /**
     * Query finds inactive conversations that need summarization:
     *
     * 1. Only conversations with no summary (summary is null or empty)
     * 2. Only conversations that either:
     *    - Have never been summarized (last_summarized_at is null), OR
     *    - Were summarized but have had new activity since then (last_active or updated_at > last_summarized_at)
     * 3. Only conversations that are inactive (last_active <= 10 minutes ago, or updated_at <= 10 minutes ago if last_active is null)
     *
     * This prevents re-summarizing conversations that were already summarized and haven't had any new activity,
     * while still allowing re-summarization when there's new content to include.
     */
    const inactiveConversations = await Memory.find({
      summary: {$in: [null, '']},
      $and: [
        {
          // Never been summarized OR has been summarized but there's been activity since then
          $or: [
            {last_summarized_at: null},
            {
              last_summarized_at: {$exists: true},
              $expr: {
                $or: [
                  // New activity tracked since last summary
                  {$gt: ['$last_active', '$last_summarized_at']},
                  // OR updated since last summary (fallback)
                  {$gt: ['$updated_at', '$last_summarized_at']},
                ],
              },
            },
          ],
        },
        {
          $or: [
            {last_active: {$lte: inactivityThreshold}},
            {last_active: null, updated_at: {$lte: inactivityThreshold}},
          ],
        },
      ],
    })
      .select('_id')
      .limit(BATCH_SIZE);

    if (inactiveConversations.length === 0) {
      return 'No inactive conversations found';
    }

    for (const memory of inactiveConversations) {
      if (memory.type === 'story') {
        await summarizeStory(memory.id);
      } else {
        await summarizeConversation(memory.id);
      }
    }

    return `Summarized ${inactiveConversations.length} inactive conversations`;
  } catch (error) {
    logger.error(error, 'Error summarizing inactive conversations');
    throw error;
  }
}
