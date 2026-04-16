export * from './personal';
export * from './conversation';
import {Worker} from 'bullmq';
import {compareStrings, queueNames} from '../../utils';
import {summarizeAllPersonas} from './personal';
import summarizeAllMemories, {summarizeConversation} from './conversation';
import {RedisConnection} from '../../services/redis';
import summarizeStory from './story';

export default function startSummarizationWorker(connection: RedisConnection) {
  return new Worker(
    queueNames.summarization.id,
    async job => {
      if (compareStrings(job.name, queueNames.summarization.jobs.persona)) {
        const {cursor, batchSize, batchNumber} = job.data || {};
        await summarizeAllPersonas(cursor, batchSize, batchNumber);
      }
      if (
        compareStrings(job.name, queueNames.summarization.jobs.conversation)
      ) {
        const {memory_id} = job.data || {};
        if (memory_id) {
          return await summarizeConversation(memory_id);
        }
      }
      if (compareStrings(job.name, queueNames.summarization.jobs.story)) {
        const {memory_id} = job.data || {};
        if (memory_id) {
          return await summarizeStory(memory_id);
        }
      }
      if (compareStrings(job.name, queueNames.summarization.jobs.memories)) {
        return await summarizeAllMemories();
      }
    },
    {
      connection,
      concurrency: 1,
      limiter: {
        max: 5,
        duration: 60000,
      },
    },
  );
}
