import {RequestHandler, Router, type IRouter} from 'express';
import * as ctrl from './controller';
import valid from './validator';
import gaurd from '../../../middleware/gaurd';
import fileUploadMiddleWare from '../../../middleware/file-upload';
import {idValidator} from '../../../utils/helpers';
import {requireFeature} from '../../../middleware/feature-gate';

const router: IRouter = Router();

router.get('/', gaurd, ctrl.getPrompts);
router.post(
  '/reply',
  gaurd,
  requireFeature('prompts.reply'),
  fileUploadMiddleWare.array('file', 5) as RequestHandler,
  valid.replyPrompt,
  ctrl.replyPrompt,
);
router.get('/reply/:id', gaurd, idValidator, ctrl.getUserPrompt);
router.get(
  '/suggestions',
  gaurd,
  requireFeature('prompts.suggestions'),
  ctrl.getSuggestions,
);
router.get(
  '/suggestions/overview',
  gaurd,
  requireFeature('prompts.suggestions'),
  ctrl.getOverviewPrompts,
);
router.get(
  '/categories',
  gaurd,
  requireFeature('prompts.category_explore'),
  ctrl.getExploreCategories,
);
router.get(
  '/categories/:id',
  gaurd,
  requireFeature('prompts.category_explore'),
  ctrl.getPromptsByCategory,
);
router.post(
  '/:id/feedback',
  gaurd,
  requireFeature('prompts.category_explore'),
  idValidator,
  valid.exploreQuestionFeedback,
  ctrl.setExploreQuestionFeedback,
);
router.get('/:id', gaurd, idValidator, ctrl.getPromptDetails);

export const name = 'prompts';
export default router;
