import {Application, IRouter, NextFunction, Request, Response} from 'express';
import {responsHandler} from '../../utils/helpers';
import {StatusCodes} from 'http-status-codes';
import errorHandler from '../../middleware/error-handler';
import activityRoutes from './activity/routes';
import aiRoutes from './ai/routes';
import authRoutes from './auth/routes';
import beneficiaryRoutes from './beneficiary/routes';
import billingRoutes from './billing/routes';
import capsuleRoutes from './capsule/routes';
import featureFlagRoutes from './feature-flag/routes';
import feedbackRoutes from './feedback/routes';
import fileRoutes from './file/routes';
import groupRoutes from './group/routes';
import memoryRoutes from './memory/routes';
import personaRoutes from './persona/routes';
import promptRoutes from './prompt/routes';
import sentryTunnelRoutes from './sentry_tunnel/routes';
import userRoutes from './user/routes';
import webhookRoutes from './webhook/routes';

const API_ROUTES: ReadonlyArray<{path: string; router: IRouter}> = [
  {path: 'activities', router: activityRoutes},
  {path: 'ai', router: aiRoutes},
  {path: 'auth', router: authRoutes},
  {path: 'beneficiaries', router: beneficiaryRoutes},
  {path: 'billing', router: billingRoutes},
  {path: 'capsule', router: capsuleRoutes},
  {path: 'feature-flags', router: featureFlagRoutes},
  {path: 'feedback', router: feedbackRoutes},
  {path: 'files', router: fileRoutes},
  {path: 'groups', router: groupRoutes},
  {path: 'memories', router: memoryRoutes},
  {path: 'persona', router: personaRoutes},
  {path: 'prompts', router: promptRoutes},
  {path: 'sentry_tunnel', router: sentryTunnelRoutes},
  {path: 'users', router: userRoutes},
  {path: 'webhooks', router: webhookRoutes},
];

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
  for (const route of API_ROUTES) {
    app.use(`/${route.path}`, route.router);
  }

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
