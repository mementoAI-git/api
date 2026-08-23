import {RedisConnection} from '../../services/redis';
import {Worker} from 'bullmq';
import {
  extractBatchInsights,
  extractOpenThreads,
  extractConversationDimensions,
} from './persona';
import {extractStoryInsights} from './story';
import {PERSONA_INSIGHT_FIELDS} from '../../utils';
import PendingInsight, {
  PendingInsightSource,
} from '../../module/database/model/pending-insight';
import Persona from '../../module/database/model/persona';
import Memory from '../../module/database/model/memory';
import {invalidateEnrichmentCache} from '../../services/enrichment';

async function savePendingInsights(
  insights: Record<string, unknown>,
  userId: string,
  memoryId: string,
  source: PendingInsightSource,
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
        docs.push({
          user: userId,
          memory: memoryId,
          source,
          field,
          content: text,
        });
      }
    }
  }

  if (docs.length > 0) {
    await PendingInsight.insertMany(docs);
  }
}

export default function startInsightsExtractionWorker(
  connection: RedisConnection,
) {
  return new Worker(
    'insights-extraction',
    async job => {
      const {user_id, memory_id, exchanges} = job.data;

      const isStory = !exchanges || exchanges.length === 0;
      const source: PendingInsightSource = isStory ? 'story' : 'conversation';

      const insights = isStory
        ? await extractStoryInsights(memory_id, user_id)
        : await extractBatchInsights(user_id, exchanges);

      if (insights && typeof insights === 'object') {
        await savePendingInsights(insights, user_id, memory_id, source);
      }

      if (!isStory) {
        try {
          const [threads, dims] = await Promise.all([
            extractOpenThreads(user_id, exchanges),
            extractConversationDimensions(exchanges),
          ]);

          if (threads) {
            await Persona.findOneAndUpdate(
              {user: user_id},
              {$set: {open_threads: threads}},
              {upsert: true},
            );
          }

          if (dims && dims.length > 0) {
            await Memory.findByIdAndUpdate(memory_id, {
              $addToSet: {dimensions: {$each: dims}},
            });
            // New dimensions change the enrichment score — bust the cache
            void invalidateEnrichmentCache(user_id);
          }
        } catch (err) {
          console.error('Error running parallel insight extractions:', err);
        }
      }
    },
    {
      connection,
      concurrency: 2,
      limiter: {max: 10, duration: 60000},
    },
  );
}
