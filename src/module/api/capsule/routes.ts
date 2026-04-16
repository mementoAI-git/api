import {Router, type IRouter} from 'express';
import gaurd from '../../../middleware/gaurd';
import * as ctrl from './controller';
import valid from './validator';

const router: IRouter = Router();

router.post('/', valid.createCapsule, gaurd, ctrl.createCapsule);
router.put('/:id', valid.updateCapsule, gaurd, ctrl.updateCapsule);
router.get('/stats', gaurd, ctrl.getCapsuleStats);
router.get('/', valid.getCapsules, gaurd, ctrl.getCapsules);
router.get('/:id', gaurd, ctrl.getCapsule);
router.delete('/:id', gaurd, ctrl.deleteCapsule);

export default router;
