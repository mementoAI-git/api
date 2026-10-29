import {Router, type IRouter} from 'express';
import gaurd from '../../../middleware/gaurd';
import * as ctrl from './controller';

const router: IRouter = Router();

router.get('/background-music', gaurd, ctrl.listBackgroundMusic);

export const name = 'media';
export default router;
