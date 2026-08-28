import {Router, type IRouter} from 'express';
import express from 'express';
import * as ctrl from './controller';
import rateLimiter from '../../../middleware/rate-limiter';
import {
  TALLY_WEBHOOK_ENABLED,
  TALLY_WEBHOOK_RATE_LIMIT_PER_MINUTE,
} from '../../../utils/config';

type WebhookRouteOptions = {
  tallyEnabled?: boolean;
  tallyRateLimitPerMinute?: number;
};

export function createWebhookRouter({
  tallyEnabled = TALLY_WEBHOOK_ENABLED,
  tallyRateLimitPerMinute = TALLY_WEBHOOK_RATE_LIMIT_PER_MINUTE,
}: WebhookRouteOptions = {}): IRouter {
  const router: IRouter = Router();

  if (tallyEnabled) {
    router.post(
      '/tally',
      rateLimiter(1, tallyRateLimitPerMinute),
      ctrl.handleTally,
    );
  }
  router.post(
    '/payments',
    express.raw({type: 'application/json'}),
    ctrl.handlePayments,
  );

  return router;
}

export const name = 'webhooks';
export default createWebhookRouter();
