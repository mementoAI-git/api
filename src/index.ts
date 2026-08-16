import {createServer, startServer} from './app';
import logger from './utils/logger';
import {connectMongodb} from './module/database/connection';
import redis from './services/redis';
import {initializeScheduler} from './services/queues';
import {transport} from './module/mail';

async function bootstrap(): Promise<void> {
  try {
    // Connect to database
    await connectMongodb();
    await redis.connect();
    await initializeScheduler();

    transport.verify((error, success) => {
      if (error)
        logger.error(error, 'SMTP transport verification failed at startup');
      else logger.info(success, 'SMTP transport verified successfully');
    });

    process.on('uncaughtException', error => {
      logger.error(error, 'Uncaught Exception');
      process.exit(1); // eslint-disable-line n/no-process-exit
    });

    process.on('unhandledRejection', reason => {
      logger.error(reason, 'Unhandled rejection');
    });

    process.on('SIGINT', () => {
      logger.info('Application shutting down...');
      process.exit(0); // eslint-disable-line n/no-process-exit
    });

    // Create and start server
    const app = createServer();
    startServer(app);
  } catch (error) {
    logger.fatal(error, 'Failed to start server');
    process.exit(1); // eslint-disable-line n/no-process-exit
  }
}

void bootstrap();
