import express, {Router} from 'express';
import * as ctrl from './controller';

const router = Router();

router.post('/', express.raw({limit: '5mb', type: () => true}), ctrl.tunnel);

export const name = 'sentry_tunnel';
export default router;
