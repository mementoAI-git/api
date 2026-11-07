import {Application, IRouter, NextFunction, Request, Response} from 'express';
import {errorResponsHandler, responsHandler} from '../../utils/helpers';
import {StatusCodes} from 'http-status-codes';
import errorHandler from '../../middleware/error-handler';
import activityRoutes from './activity/routes';
import archiveRoutes from './archive/routes';
import aiRoutes from './ai/routes';
import authRoutes from './auth/routes';
import beneficiaryRoutes from './beneficiary/routes';
import billingRoutes from './billing/routes';
import capsuleRoutes from './capsule/routes';
import featureFlagRoutes from './feature-flag/routes';
import feedbackRoutes from './feedback/routes';
import fileRoutes from './file/routes';
import groupRoutes from './group/routes';
import mediaRoutes from './media/routes';
import memoryRoutes from './memory/routes';
import personaRoutes from './persona/routes';
import peopleRoutes from './people/routes';
import promptRoutes from './prompt/routes';
import pushDeviceRoutes from './push-device/routes';
import sentryTunnelRoutes from './sentry_tunnel/routes';
import userRoutes from './user/routes';
import publicProfileRoutes from './public-profile/routes';
import publicStoryRoutes from './public-story/routes';
import webhookRoutes from './webhook/routes';
import {SENTRY_TUNNEL_ENABLED} from '../../utils/config';
import {getReadiness} from '../../services/readiness';
import staffRoutes from './staff/routes';

const API_ROUTES: ReadonlyArray<{path: string; router: IRouter}> = [
  {path: 'staff', router: staffRoutes},
  {path: 'activities', router: activityRoutes},
  {path: 'exports', router: archiveRoutes},
  {path: 'ai', router: aiRoutes},
  {path: 'auth', router: authRoutes},
  {path: 'beneficiaries', router: beneficiaryRoutes},
  {path: 'billing', router: billingRoutes},
  {path: 'capsule', router: capsuleRoutes},
  {path: 'feature-flags', router: featureFlagRoutes},
  {path: 'feedback', router: feedbackRoutes},
  {path: 'files', router: fileRoutes},
  {path: 'groups', router: groupRoutes},
  {path: 'media', router: mediaRoutes},
  {path: 'memories', router: memoryRoutes},
  {path: 'persona', router: personaRoutes},
  {path: 'people', router: peopleRoutes},
  {path: 'prompts', router: promptRoutes},
  {path: 'push-devices', router: pushDeviceRoutes},
  ...(SENTRY_TUNNEL_ENABLED
    ? [{path: 'sentry_tunnel', router: sentryTunnelRoutes}]
    : []),
  {path: 'users', router: userRoutes},
  {path: 'public/profiles', router: publicProfileRoutes},
  {path: 'public/stories', router: publicStoryRoutes},
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

async function ready(_req: Request, res: Response) {
  const readiness = await getReadiness();
  if (!readiness.ready) {
    return errorResponsHandler(
      res,
      StatusCodes.SERVICE_UNAVAILABLE,
      'Service is not ready',
      {
        code: 'service_unavailable',
        data: {
          status: 'not_ready',
          dependencies: readiness.dependencies,
        },
      },
    );
  }

  return responsHandler(res, StatusCodes.OK, 'Ready', readiness);
}

function router(app: Application) {
  for (const route of API_ROUTES) {
    app.use(`/${route.path}`, route.router);
  }

  app.get('/health', health);
  app.get('/ready', ready);
  app.use((_req, res, _next) => {
    return errorResponsHandler(
      res,
      StatusCodes.NOT_FOUND,
      'Resource does not exist, check endpoint or method',
      {code: 'not_found'},
    );
  });

  app.use(errorHandler);
}

export default router;
