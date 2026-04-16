import {Application, NextFunction, Request, Response} from 'express';
import {existsSync, readdirSync} from 'fs';
import {join} from 'path';
import {responsHandler} from '../../utils/helpers';
import {StatusCodes} from 'http-status-codes';
import errorHandler from '../../middleware/error-handler';

function health(_req: Request, res: Response, _next: NextFunction) {
  const healthcheck = {
    uptime: process.uptime(),
    responsetime: process.hrtime(),
    message: 'OK',
    status: StatusCodes.OK,
    timestamp: Date.now(),
  };

  return responsHandler(res, StatusCodes.OK, 'OK', healthcheck);
}

function router(app: Application) {
  readdirSync(__dirname)
    .filter(file => !file.startsWith('.') && !file.includes('index'))
    .filter(
      file =>
        existsSync(join(__dirname, file, 'routes.ts')) ||
        existsSync(join(__dirname, file, 'routes.js')),
    )
    .forEach(file => {
      const route = require(`./${file}/routes`);
      const path = route?.name || file.replace(/\.[^/.]+$/, '');

      app.use(`/${path}`, route.default || route);
    });

  app.get('/health', health);
  app.use((req, res, next) => {
    return responsHandler(
      res,
      StatusCodes.NOT_FOUND,
      'Resource does not exist, check endpoint or method',
    );
  });

  app.use(errorHandler);
}

export default router;
