import { RequestHandler, Router, type IRouter } from 'express';
import gaurd from '../../../middleware/gaurd';
import * as ctrl from './controller';
import valid from './validator';
import fileUploadMiddleWare from '../../../middleware/file-upload';

const router: IRouter = Router();
router.use(gaurd)

router.get('/profile', ctrl.getProfile);
router.post('/change-password', valid.setPassword, ctrl.setPassword);
router.put('/profile', ctrl.updateProfile);
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

// TODO: Remove this route after migration is complete
router.post('/migrate-context-to-persona', ctrl.migrateContextToPersona);

export const name = 'users';
export default router;
