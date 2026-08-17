import {RequestHandler, Router, type IRouter} from 'express';
import gaurd from '../../../middleware/gaurd';
import * as ctrl from './controller';
import fileUploadMiddleWare from '../../../middleware/file-upload';
import {requireFeature} from '../../../middleware/feature-gate';

const router: IRouter = Router();

router.post(
  '/upload',
  gaurd,
  requireFeature('attachments.doc_upload'),
  fileUploadMiddleWare.array('file', 5) as RequestHandler,
  ctrl.uploadFile,
);
router.get('/', gaurd, ctrl.getUserFiles);
router.get('/:name(*)', ctrl.getFile);
router.delete('/:name(*)', gaurd, ctrl.removeFile);

export const name = 'files';
export default router;
