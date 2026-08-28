import logger from './utils/logger';
import {validateRuntimeConfig} from './utils/runtime-config';

async function bootstrap(): Promise<void> {
  try {
    validateRuntimeConfig(process.env);
    const [appModule, databaseModule, redisModule, queuesModule, mailModule] =
      await Promise.all([
        import('./app'),
        import('./module/database/connection'),
        import('./services/redis'),
        import('./services/queues'),
        import('./module/mail'),
      ]);

    // Connect to database
    await databaseModule.connectMongodb();
    await redisModule.default.connect();
    await queuesModule.initializeScheduler();

    mailModule.transport.verify((error, success) => {
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
    const app = appModule.createServer();
    appModule.startServer(app);
  } catch (error) {
    logger.fatal(error, 'Failed to start server');
    process.exit(1); // eslint-disable-line n/no-process-exit
  }
}

void bootstrap();
