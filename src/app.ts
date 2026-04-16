import express, {Application} from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import router from './module/api';
import path from 'path';
// eslint-disable-next-line n/no-unpublished-import
import setupSwagger from './docs';
import {httpLogger} from './middleware/http-logger';
import {setupBullBoard} from './services/queues';
import {PORT} from './utils/config';
import {logger} from './utils';

export function createServer(): Application {
  const app = express();

  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(
    cors({
      origin: '*',
      credentials: true,
      optionsSuccessStatus: 200,
    }),
  );

  app.use(express.urlencoded({extended: false}));
  app.use(express.json({limit: '100mb'}));
  app.use('/assets', express.static(path.join(process.cwd(), 'public')));

  app.use(httpLogger);
  setupBullBoard(app);

  app.use(
    compression({
      level: 6,
      threshold: 1024,
      filter: (req, res) => {
        if (req.headers['x-no-compression']) {
          return false;
        }
        return compression.filter(req, res);
      },
    }),
  );

  // app.use(rateLimiter(1, 100))
  setupSwagger(app);
  router(app);

  app.disable('x-powered-by');
  return app;
}

export function startServer(app: express.Application) {
  app.listen(PORT, () => {
    logger.info(`Application runing on port ${PORT}...`);
  });
}
