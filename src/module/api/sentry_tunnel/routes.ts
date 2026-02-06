import express, {Router, type IRouter} from 'express';
import * as ctrl from './controller';

const router: IRouter = Router();

router.post('/', express.raw({limit: '5mb', type: () => true}), ctrl.tunnel);

export const name = 'sentry_tunnel';
export default router;
