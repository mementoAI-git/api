import {Router, type IRouter} from 'express';
import express from 'express';
import * as ctrl from './controller';
import rateLimiter from '../../../middleware/rate-limiter';
import {
  TALLY_WEBHOOK_ENABLED,
  TALLY_WEBHOOK_RATE_LIMIT_PER_MINUTE,
  APPLE_IAP_NOTIFICATIONS_ENABLED,
  GOOGLE_PLAY_RTDN_ENABLED,
} from '../../../utils/config';

type WebhookRouteOptions = {
  tallyEnabled?: boolean;
  tallyRateLimitPerMinute?: number;
  appleIapEnabled?: boolean;
  googlePlayRtdnEnabled?: boolean;
};

export function createWebhookRouter({
  tallyEnabled = TALLY_WEBHOOK_ENABLED,
  tallyRateLimitPerMinute = TALLY_WEBHOOK_RATE_LIMIT_PER_MINUTE,
  appleIapEnabled = APPLE_IAP_NOTIFICATIONS_ENABLED,
  googlePlayRtdnEnabled = GOOGLE_PLAY_RTDN_ENABLED,
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
  if (appleIapEnabled) router.post('/apple/app-store', ctrl.handleAppleStore);
  if (googlePlayRtdnEnabled) router.post('/google/play', ctrl.handleGooglePlay);

  return router;
}

export const name = 'webhooks';
export default createWebhookRouter();
