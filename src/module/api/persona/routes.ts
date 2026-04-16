import {Router, type IRouter} from 'express';
import gaurd from '../../../middleware/gaurd';
import validate from '../../../middleware/validator';
import * as dto from './dto';
import * as ctrl from './controller';

const router: IRouter = Router();

router.use(gaurd);

router.get(
  '/pending-insights',
  validate(dto.listPendingInsightsSchema),
  ctrl.listPendingInsights,
);
router.post(
  '/pending-insights/:pendingId/approve',
  validate(dto.pendingInsightActionSchema),
  ctrl.approvePendingInsight,
);
router.post(
  '/pending-insights/:pendingId/reject',
  validate(dto.pendingInsightActionSchema),
  ctrl.rejectPendingInsight,
);

export const name = 'persona';
export default router;
