import {Router, type IRouter} from 'express';
import gaurd from '../../../middleware/gaurd';
import {evaluateFlag, evaluatedFlags} from './controller';

const router: IRouter = Router();
// Customer evaluation stays available; management lives exclusively under /staff.
router.get('/evaluated', gaurd, evaluatedFlags);
router.get('/evaluate/:key', gaurd, evaluateFlag);
export const name = 'feature-flags';
export default router;
