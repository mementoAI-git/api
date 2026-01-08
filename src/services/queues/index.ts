import { Application } from 'express';
import { initializeConversationSummary, initializePersonaSummarization, summarizationQueue } from './summarization';
import { ExpressAdapter } from "@bull-board/express";
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter"
import { insightQueue } from './insights';
import { initializeResetStreak, systemQueue } from './system';
import logger from '../../utils/logger';

export function setupBullBoard(app: Application) {
  const serverAdapter = new ExpressAdapter();

  const path = '/queues'

  serverAdapter.setBasePath(path);

  const queues = [
    summarizationQueue,
    insightQueue,
    systemQueue
  ].map((queue) => new BullMQAdapter(queue))

  createBullBoard({
    queues,
    serverAdapter,
  });

  app.use(path, serverAdapter.getRouter());
}

export async function initializeScheduler() {
  logger.info('Initializing scheduler...');
  await initializeResetStreak();
  await initializePersonaSummarization();
  await initializeConversationSummary();
}

export * from './insights';
export * from './summarization';

