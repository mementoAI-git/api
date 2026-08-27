import express, {Router, type IRouter} from 'express';
import * as ctrl from './controller';
import rateLimiter from '../../../middleware/rate-limiter';
import {
  SENTRY_TUNNEL_MAX_BYTES,
  SENTRY_TUNNEL_RATE_LIMIT_PER_MINUTE,
} from '../../../utils/config';

const router: IRouter = Router();

router.post(
  '/',
  rateLimiter(1, SENTRY_TUNNEL_RATE_LIMIT_PER_MINUTE),
  express.raw({
    limit: SENTRY_TUNNEL_MAX_BYTES,
    type: 'application/x-sentry-envelope',
  }),
  ctrl.tunnel,
);

export const name = 'sentry_tunnel';
export default router;
