import {Router, type IRouter} from 'express';
import guard from '../../../middleware/gaurd';
import validate from '../../../middleware/validator';
import {requireFeature} from '../../../middleware/feature-gate';
import {
  voiceStatusSchema,
  voiceRecordSchema,
  spaceSchema,
  contributionSchema,
  shareSchema,
  itemSchema,
  sourcesSchema,
  personSchema,
  labelSchema,
  disconnectSchema,
  activationSchema,
  talkSchema,
  talkHistorySchema,
} from './dto';
import * as controller from './controller';

const router: IRouter = Router();
router.get('/', guard, controller.list);
router.get(
  '/:personId/voice/:sessionId',
  guard,
  validate(voiceStatusSchema),
  controller.voiceStatus,
);
router.post(
  '/:personId/voice',
  guard,
  requireFeature('ai.live_ephemeral_token'),
  validate(voiceRecordSchema),
  controller.voiceRecord,
);
router.get(
  '/:personId/talk',
  guard,
  validate(talkHistorySchema),
  controller.talkHistory,
);
router.post(
  '/:personId/talk',
  guard,
  requireFeature('chat.conversation_stream'),
  validate(talkSchema),
  controller.talkSend,
);
router.get('/activation', guard, controller.getActivation);
router.put(
  '/activation',
  guard,
  validate(activationSchema),
  controller.setActivation,
);
router.get('/blocked', guard, controller.blocked);
router.delete(
  '/blocked/:personId',
  guard,
  validate(personSchema),
  controller.unblock,
);
router.get(
  '/:personId/settings',
  guard,
  validate(personSchema),
  controller.getSettings,
);
router.patch(
  '/:personId/settings',
  guard,
  validate(labelSchema),
  controller.label,
);
router.post(
  '/:personId/disconnect',
  guard,
  validate(disconnectSchema),
  controller.disconnect,
);
router.get('/sources', guard, validate(sourcesSchema), controller.sources);
router.post(
  '/:personId/items',
  guard,
  requireFeature('memory.create'),
  validate(contributionSchema),
  controller.contribute,
);
router.post(
  '/:personId/share',
  guard,
  requireFeature('memory.edit'),
  validate(shareSchema),
  controller.share,
);
router.get(
  '/:personId/items/:sourceId',
  guard,
  validate(itemSchema),
  controller.detail,
);
router.delete(
  '/:personId/items/:sourceId',
  guard,
  requireFeature('memory.edit'),
  validate(itemSchema),
  controller.remove,
);
router.get('/:personId/space', guard, validate(spaceSchema), controller.space);
export default router;
