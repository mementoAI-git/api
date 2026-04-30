import {Router, type IRouter} from 'express';
import gaurd from '../../../middleware/gaurd';
import * as ctrl from './controller';
import valid from './validator';
import {requireFeature} from '../../../middleware/feature-gate';

const router: IRouter = Router();

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
