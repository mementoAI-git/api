import {Router, type IRouter} from 'express';
import gaurd from '../../../middleware/gaurd';
import * as ctrl from './controller';
import valid from './validator';

const router: IRouter = Router();

router.post('/', valid.createFeedback, gaurd, ctrl.createFeedback);

export const name = 'feedback';
export default router;
