import {Router, type IRouter} from 'express';
import gaurd from '../../../middleware/gaurd';
import * as ctrl from './controller';

const router: IRouter = Router();
router.post('/archive', gaurd, ctrl.create);
router.get('/archive/:id', gaurd, ctrl.getOne);
router.post('/archive/:id/download', gaurd, ctrl.download);

export default router;
