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

router.get('/observations', ctrl.listObservations);
router.get(
  '/observations/:observationId/sources',
  validate(dto.observationParamsSchema),
  ctrl.getObservationSources,
);
router.patch(
  '/observations/:observationId',
  validate(dto.updateObservationSchema),
  ctrl.updateObservation,
);
router.delete(
  '/observations/:observationId',
  validate(dto.observationParamsSchema),
  ctrl.forgetObservation,
);

export const name = 'persona';
export default router;
