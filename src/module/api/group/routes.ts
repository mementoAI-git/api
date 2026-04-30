import {Router, type IRouter} from 'express';
import * as ctrl from './controller';
import gaurd from '../../../middleware/gaurd';
import * as dto from './dto';
import validate from '../../../middleware/validator';
import {requireFeature} from '../../../middleware/feature-gate';

const router: IRouter = Router();

router.post(
  '/',
  gaurd,
  requireFeature('group.create'),
  validate(dto.createGroupSchema),
  ctrl.create,
);
router.get('/', gaurd, ctrl.list);
router.get(
  '/search',
  gaurd,
  requireFeature('group.search'),
  validate(dto.searchSchema),
  ctrl.search,
);
router.get('/:id', gaurd, validate(dto.getGroupSchema), ctrl.getOne);
router.put(
  '/:id',
  gaurd,
  requireFeature('group.update'),
  validate(dto.updateGroupSchema),
  ctrl.update,
);
router.delete(
  '/:id',
  gaurd,
  requireFeature('group.delete'),
  validate(dto.deleteGroupSchema),
  ctrl.del,
);
router.post(
  '/:id/members',
  gaurd,
  requireFeature('group.add_member'),
  validate(dto.addMembersSchema),
  ctrl.addMembers,
);
router.delete(
  '/:id/members/:beneficiaryId',
  gaurd,
  requireFeature('group.remove_member'),
  validate(dto.removeMemberSchema),
  ctrl.removeMember,
);

export const name = 'groups';
export default router;
