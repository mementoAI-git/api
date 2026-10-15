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
import {CORS_ALLOWED_ORIGINS, JSON_BODY_LIMIT, PORT} from './utils/config';
import {logger} from './utils';
import {ForbiddenException} from './utils/service-error';
import requestContext from './middleware/request-context';
import {warmUpEmbeddings} from './services/embeddings';

export function createServer(): Application {
  const app = express();

  app.set('trust proxy', 1);
  app.use(requestContext);

  app.use(helmet());
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || CORS_ALLOWED_ORIGINS.includes(origin)) {
          callback(null, true);
          return;
        }

        logger.warn(
          `CORS rejected origin: "${origin}". Allowed: ${CORS_ALLOWED_ORIGINS.join(', ')}`,
        );
        callback(new ForbiddenException('Not allowed by CORS'));
      },
      credentials: false,
      optionsSuccessStatus: 200,
    }),
  );

  app.use(express.urlencoded({extended: false}));
  app.use(
    express.json({
      limit: JSON_BODY_LIMIT,
      verify: (req: express.Request | any, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );
  app.use('/assets', express.static(path.join(process.cwd(), 'public')));
  app.use(
    '/.well-known',
    express.static(path.join(process.cwd(), 'public/.well-known')),
  );

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
    logger.info(`Application running on port ${PORT}...`);
    warmUpEmbeddings(error =>
      logger.warn({err: error}, 'Memory embedding model failed to load'),
    );
  });
}
