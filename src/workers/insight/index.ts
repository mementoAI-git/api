import { RedisConnection } from "../../services/redis";
import { Worker } from "bullmq";
import { extractBatchInsights } from "./persona";
import { extractStoryInsights } from "./story";
import { PERSONA_INSIGHT_FIELDS } from "../../utils";
import PendingInsight, { PendingInsightSource } from "../../module/database/model/pending-insight";

async function savePendingInsights(
  insights: Record<string, unknown>,
  userId: string,
  memoryId: string,
  source: PendingInsightSource
): Promise<void> {
  const docs: Array<{
    user: string;
    memory: string;
    source: PendingInsightSource;
    field: string;
    content: string;
  }> = [];

  for (const field of PERSONA_INSIGHT_FIELDS) {
    const items = insights[field];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const text = typeof item === 'string' ? item.trim() : '';
      if (text) {
        docs.push({ user: userId, memory: memoryId, source, field, content: text });
      }
    }
  }

  if (docs.length > 0) {
    await PendingInsight.insertMany(docs);
  }
}

export default function startInsightsExtractionWorker(connection: RedisConnection) {
  return new Worker(
    'insights-extraction',
    async (job) => {
      const { user_id, memory_id, exchanges } = job.data;

      const isStory = !exchanges || exchanges.length === 0;
      const source: PendingInsightSource = isStory ? 'story' : 'conversation';

      const insights = isStory
        ? await extractStoryInsights(memory_id, user_id)
        : await extractBatchInsights(user_id, exchanges);

      if (!insights || typeof insights !== 'object') return;

      await savePendingInsights(insights, user_id, memory_id, source);
    },
    {
      connection,
      concurrency: 2,
      limiter: { max: 10, duration: 60000 }
    }
  );
}
