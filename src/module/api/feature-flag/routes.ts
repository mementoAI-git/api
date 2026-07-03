import {Router, type IRouter} from 'express';
import gaurd from '../../../middleware/gaurd';
import adminGuard from '../../../middleware/admin-guard';
import * as ctrl from './controller';

const router: IRouter = Router();

router.get('/', gaurd, adminGuard, ctrl.listFlags);
router.get('/evaluate/:key', gaurd, ctrl.evaluateFlag);
router.get('/:key', gaurd, adminGuard, ctrl.getFlag);
router.get('/:key/audit', gaurd, adminGuard, ctrl.audit);
router.put('/:key/default', gaurd, adminGuard, ctrl.updateDefault);
router.put(
  '/:key/overrides/:scopeType/:scopeId',
  gaurd,
  adminGuard,
  ctrl.upsertOverride,
);
router.delete(
  '/:key/overrides/:scopeType/:scopeId',
  gaurd,
  adminGuard,
  ctrl.removeOverride,
);
router.put(
  '/:key/rollout/:scopeType/:scopeId',
  gaurd,
  adminGuard,
  ctrl.updateRollout,
);
router.post('/bulk', gaurd, adminGuard, ctrl.bulk);

export const name = 'feature-flags';
export default router;
