import {Router, type IRouter} from 'express';
import gaurd from '../../../middleware/gaurd';
import validate from '../../../middleware/validator';
import * as ctrl from './controller';
import {createFeedbackSchema} from './validator';

const router: IRouter = Router();

router.post('/', gaurd, validate(createFeedbackSchema), ctrl.createFeedback);

export const name = 'feedback';
export default router;
