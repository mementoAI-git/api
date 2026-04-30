import {Router, type IRouter} from 'express';
import valid from './validator';
import * as ctrl from './controller';
import * as dto from './dto';
import gaurd from '../../../middleware/gaurd';
import validate from '../../../middleware/validator';
import {requireFeature} from '../../../middleware/feature-gate';

const router: IRouter = Router();

router.post(
  '/',
  gaurd,
  requireFeature('beneficiary.create'),
  validate(dto.createBeneficiarySchema),
  ctrl.create,
);
router.get('/', gaurd, ctrl.list);
router.put(
  '/:id',
  gaurd,
  requireFeature('beneficiary.update'),
  valid.updateBeneficiary,
  ctrl.update,
);
router.delete('/:id', gaurd, requireFeature('beneficiary.delete'), ctrl.del);
router.post(
  '/invite/resend',
  gaurd,
  requireFeature('beneficiary.resend_invite'),
  valid.resendInvite,
  ctrl.resendInvite,
);
router.post(
  '/invite/accept',
  requireFeature('beneficiary.accept_invite'),
  valid.acceptInvite,
  ctrl.acceptInvite,
);
router.get('/invite/:id', valid.getInvite, ctrl.getInvite);

export const name = 'beneficiaries';
export default router;
