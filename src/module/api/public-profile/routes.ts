import {Router} from 'express';
import {rateLimit} from 'express-rate-limit';
import {view} from './controller';
const router = Router();
router.get('/:token', rateLimit({windowMs: 60000, limit: 120}), view);
export const name = 'public/profiles';
export default router;
