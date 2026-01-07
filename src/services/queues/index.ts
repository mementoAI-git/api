import { Application } from 'express';
import { summarizationQueue } from './summarization';
import { ExpressAdapter } from "@bull-board/express";
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter"

export function setupBullBoard(app: Application) {
  const serverAdapter = new ExpressAdapter();

  const path = '/queues'

  serverAdapter.setBasePath(path);

  const queues = [summarizationQueue].map((queue) => new BullMQAdapter(queue))

  createBullBoard({
    queues,
    serverAdapter,
  });

  app.use(path, serverAdapter.getRouter());
}

export * from './insights';
export * from './summarization';

