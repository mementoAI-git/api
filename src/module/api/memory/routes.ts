import {RequestHandler, Router, type IRouter} from 'express';
import valid from './validator';
import gaurd from '../../../middleware/gaurd';
import * as ctrl from './controller';
import fileUploadMiddleWare from '../../../middleware/file-upload';
import {requireFeature} from '../../../middleware/feature-gate';
import rateLimit from 'express-rate-limit';
import type {IRequest} from '../../../utils/interface';

const router: IRouter = Router();

router.get('/stats', gaurd, ctrl.memoryStats);
router.get(
  '/search',
  gaurd,
  rateLimit({
    windowMs: 60_000,
    limit: 60,
    keyGenerator: req => (req as IRequest).auth.id,
    standardHeaders: true,
    legacyHeaders: false,
  }),
  valid.search,
  ctrl.searchMemory,
);
router.post(
  '/',
  gaurd,
  requireFeature('memory.create'),
  fileUploadMiddleWare.array('file', 5) as RequestHandler,
  valid.createMemory,
  ctrl.createMemory,
);
router.post(
  '/quick-capture',
  gaurd,
  requireFeature('memory.create'),
  fileUploadMiddleWare.array('file', 5) as RequestHandler,
  valid.quickCapture,
  ctrl.quickCaptureMemory,
);
router.delete(
  '/remove-file/:id',
  gaurd,
  valid.removeFileFromMemory,
  ctrl.removeFileFromMemory,
);
router.delete(
  '/:memoryId/attachments/:fileId',
  gaurd,
  valid.detachFileFromMemory,
  ctrl.detachFileFromMemory,
);
router.get('/conversations', gaurd, ctrl.getConversationMemories);
router.get('/stories', gaurd, ctrl.getStoryMemories);
router.get('/', gaurd, ctrl.getMemories);
router.get('/prompt/:id', gaurd, ctrl.getMemoryByPrompt);
router.get('/public/:id', valid.publicMemory, ctrl.getPublicMemory);
router.get('/:id/enrichment', gaurd, ctrl.getConversationEnrichment);
router.get('/:id/attachments', gaurd, ctrl.getMemoryAttachments);
router.get('/:id', gaurd, ctrl.getMemory);
router.put(
  '/:id',
  gaurd,
  requireFeature('memory.edit'),
  valid.updateMemory,
  ctrl.updateMemory,
);
router.delete(
  '/:id',
  gaurd,
  requireFeature('memory.delete'),
  valid.deleteMemory,
  ctrl.deleteMemory,
);
router.post('/:id/restore', gaurd, ctrl.restoreMemory);
router.post('/:id/bookmark', gaurd, ctrl.bookmark);
router.delete('/:id/bookmark', gaurd, ctrl.unbookmark);
router.post(
  '/add-message',
  gaurd,
  valid.addMessageToMemory,
  ctrl.addMessageToMemory,
);

export const name = 'memories';
export default router;
