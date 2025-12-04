import {RequestHandler, Router} from 'express';
import valid from './validator';
import gaurd from '../../../middleware/gaurd';
import * as ctrl from './controller';
import fileUploadMiddleWare from '../../../middleware/file-upload';

const router = Router();

router.get('/stats', gaurd, ctrl.memoryStats);
router.post(
  '/',
  gaurd,
  fileUploadMiddleWare.array('file', 5) as RequestHandler,
  valid.createMemory,
  ctrl.createMemory,
);
router.delete(
  '/remove-file/:id',
  gaurd,
  valid.removeFileFromMemory,
  ctrl.removeFileFromMemory,
);
router.get('/conversations', gaurd, ctrl.getConversationMemories);
router.get('/stories', gaurd, ctrl.getStoryMemories);
router.get('/', gaurd, ctrl.getMemories);
router.get('/prompt/:id', gaurd, ctrl.getMemoryByPrompt);
router.get('/:id', gaurd, ctrl.getMemory);
router.put('/:id', gaurd, valid.updateMemory, ctrl.updateMemory);
router.delete('/:id', gaurd, valid.deleteMemory, ctrl.deleteMemory);
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
