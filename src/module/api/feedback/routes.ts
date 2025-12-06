import {Router} from 'express';
import gaurd from '../../../middleware/gaurd';
import * as ctrl from './controller';
import valid from './validator';

const router = Router();

router.post('/', valid.createFeedback, gaurd, ctrl.createFeedback);

export const name = 'feedback';
export default router;
