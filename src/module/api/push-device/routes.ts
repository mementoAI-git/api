import {Router, type IRouter} from 'express';
import gaurd from '../../../middleware/gaurd';
import * as ctrl from './controller';
import * as valid from './validator';

const router: IRouter = Router();
router.use(gaurd);
router.put('/:installationId', valid.registerPushDevice, ctrl.register);
router.delete('/:installationId', valid.disablePushDevice, ctrl.disable);

export const name = 'push-devices';
export default router;
