import dayjs from "dayjs";
import Memory from "../../module/database/model/memory";
import { queueSummarization } from "../queues";

const INACTIVITY_MINUTES = 10;

export default async function summarizeInactiveConversations(): Promise<void> {
  try {
    const inactivityThreshold = dayjs().subtract(INACTIVITY_MINUTES, 'minute').toDate();

    const inactiveConversations = await Memory.find({
      type: 'conversation',
      summary: { $in: [null, ''] },
      $or: [
        { last_active: { $lte: inactivityThreshold } },
        { last_active: null, updated_at: { $lte: inactivityThreshold } }
      ]
    }).select('_id');

    if (inactiveConversations.length === 0) return;

    for (const memory of inactiveConversations) {
      await queueSummarization(memory.id);
    }
  } catch (error) {
    console.error('Error summarizing inactive conversations:', error);
  }
}