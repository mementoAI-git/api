import {Router, type IRouter} from 'express';
import guard from '../../../middleware/gaurd';
import validate from '../../../middleware/validator';
import {spaceSchema} from './dto';
import * as controller from './controller';

const router: IRouter = Router();
router.get('/', guard, controller.list);
router.get('/:personId/space', guard, validate(spaceSchema), controller.space);
export default router;
