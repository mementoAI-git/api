import {Router, type IRouter} from 'express';
import gaurd from '../../../middleware/gaurd';
import * as ctrl from './controller';
import valid from './validator';
import {requireFeature} from '../../../middleware/feature-gate';
import rateLimiter from '../../../middleware/rate-limiter';

const router: IRouter = Router();

router.post(
  '/view/exchange',
  rateLimiter(10, 10),
  valid.externalTokenExchange,
  ctrl.exchangeExternalViewToken,
);
router.get('/view', rateLimiter(1, 60), ctrl.getExternalCapsule);

router.post(
  '/',
  valid.createCapsule,
  gaurd,
  requireFeature('capsule.create'),
  ctrl.createCapsule,
);
router.put(
  '/:id',
  valid.updateCapsule,
  gaurd,
  requireFeature('capsule.edit'),
  ctrl.updateCapsule,
);
router.post(
  '/:id/schedule',
  gaurd,
  requireFeature('capsule.edit'),
  ctrl.scheduleCapsule,
);
router.get('/stats', gaurd, ctrl.getCapsuleStats);
router.get('/', valid.getCapsules, gaurd, ctrl.getCapsules);
router.get('/:id', gaurd, ctrl.getCapsule);
router.delete(
  '/:id',
  gaurd,
  requireFeature('capsule.delete'),
  ctrl.deleteCapsule,
);

export default router;
