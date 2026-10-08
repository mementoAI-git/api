import {RequestHandler, Router, type IRouter} from 'express';
import gaurd from '../../../middleware/gaurd';
import * as ctrl from './controller';
import {publish, revoke} from '../public-profile/controller';
import * as dto from './dto';
import valid from './validator';
import validate from '../../../middleware/validator';
import fileUploadMiddleWare from '../../../middleware/file-upload';
import {requireFeature} from '../../../middleware/feature-gate';

const router: IRouter = Router();
router.use(gaurd);

router.get('/profile', ctrl.getProfile);
router.post('/profile/share', publish);
router.delete('/profile/share', revoke);
router.get('/referrals', ctrl.getReferrals);
router.get('/context', ctrl.getContext);
router.get('/onboarding-details', ctrl.getOnboardingDetails);
router.post('/onboarding/skip', ctrl.skipOnboarding);
router.post('/onboarding', validate(dto.onboardingSchema), ctrl.onboarding);
router.post(
  '/onboarding/chat/prompt',
  requireFeature('onboarding.chat'),
  validate(dto.onboardingChatPromptSchema),
  ctrl.onboardingChatPrompt,
);
router.post('/change-password', valid.setPassword, ctrl.setPassword);
router.put('/profile', valid.profile, ctrl.updateProfile);
router.post('/profile', valid.profile, ctrl.updateProfile);
router.put('/banner', ctrl.updateBanner);
router.put('/banner-position', ctrl.updateBannerPosition);
router.post(
  '/upload-banner',
  fileUploadMiddleWare.array('file', 1) as RequestHandler,
  ctrl.uploadBanner,
);
router.get('/persona/memory-insights-summary', ctrl.getMemoryInsightsSummary);
router.get('/persona', ctrl.getPersona);
router.put('/persona', valid.updateContext, ctrl.updateContext);
router.post(
  '/upload-picture',
  fileUploadMiddleWare.array('file', 5) as RequestHandler,
  ctrl.uploadPicture,
);
router.get('/2fa/setup', ctrl.setup2FA);
router.post('/2fa/verify', valid.verifyTOTP, ctrl.verifyTOTP);
router.delete('/2fa/disable', ctrl.disable2FA);
router.post(
  '/complete-onboarding',
  valid.completeOnboarding,
  ctrl.completeOnboarding,
);
router.delete('/account', ctrl.deleteUser);
router.get('/stats', ctrl.getUserStats);
router.get('/passkeys', ctrl.listPasskeys);
router.delete('/passkeys/:credential_id', ctrl.deletePasskey);

export const name = 'users';
export default router;
