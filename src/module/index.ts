import { Application, NextFunction, Request, Response } from "express";
import { readdirSync } from "fs";
import { responsHandler } from "../utils/helpers";
import { StatusCodes } from "http-status-codes";
import errorHandler from "../middleware/error-handler";

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
    .forEach(file => {
      const route = require(`./${file}/routes`);
      app.use(route.default || route);
    });

  app.get('/health', health);
  app.use(errorHandler);
  app.use((req, res, next) => {
    return responsHandler(
      res,
      StatusCodes.NOT_FOUND,
      'Resource does not exist, check endpoint or method',
    );
  });
}

export default router;