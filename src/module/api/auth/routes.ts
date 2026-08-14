import {Router, type IRouter} from 'express';
import * as ctrl from './controller';
import valid from './validator';
import rateLimiter from '../../../middleware/rate-limiter';
import guard from '../../../middleware/gaurd';

const router: IRouter = Router();

const publicAuthLimiter = rateLimiter(5, 10);
const sensitiveAuthLimiter = rateLimiter(10, 5);

router.get(
  '/oauth/:provider',
  publicAuthLimiter,
  valid.generateOauthUrl,
  ctrl.generateOauthUrl,
);
router.post(
  '/oauth/:provider',
  sensitiveAuthLimiter,
  valid.authorization,
  ctrl.authorization,
);
router.post('/login', rateLimiter(5, 5), valid.login, ctrl.login);
router.post('/register', publicAuthLimiter, valid.login, ctrl.register);
router.post('/send-link', sensitiveAuthLimiter, valid.sendLink, ctrl.sendLink);
router.post(
  '/verify-email',
  sensitiveAuthLimiter,
  valid.verifyEmail,
  ctrl.verifyEmail,
);
router.post(
  '/set-password',
  sensitiveAuthLimiter,
  valid.setPassword,
  ctrl.setPassword,
);
router.post(
  '/refresh-token',
  publicAuthLimiter,
  valid.refreshToken,
  ctrl.refreshToken,
);
router.delete('/logout', guard, ctrl.logout);
router.post(
  '/send-invite-code',
  sensitiveAuthLimiter,
  valid.sendInviteCode,
  ctrl.sendInviteCode,
);

// 2FA login verification (completes a login that was paused for 2FA)
router.post(
  '/2fa/verify',
  rateLimiter(10, 5),
  valid.verify2FALogin,
  ctrl.verify2FALogin,
);

// Passkey registration (requires authenticated session)
router.post('/passkey/register/begin', guard, ctrl.beginPasskeyRegistration);
router.post(
  '/passkey/register/complete',
  guard,
  valid.completePasskeyRegistration,
  ctrl.completePasskeyRegistration,
);

// Passkey login (public — no session)
router.post(
  '/passkey/login/begin',
  sensitiveAuthLimiter,
  ctrl.beginPasskeyLogin,
);
router.post(
  '/passkey/login/complete',
  sensitiveAuthLimiter,
  valid.completePasskeyLogin,
  ctrl.completePasskeyLogin,
);

export default router;
