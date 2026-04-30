import {Router, type IRouter} from 'express';
import gaurd from '../../../middleware/gaurd';
import * as ctrl from './controller';
import valid from './validator';
import {idValidator} from '../../../utils/helpers';
import validate from '../../../middleware/validator';
import devOnly from '../../../middleware/dev-only';
import * as dto from './dto';
import {requireFeature} from '../../../middleware/feature-gate';

const router: IRouter = Router();

router.post(
  '/prompt',
  valid.prompt,
  gaurd,
  requireFeature('chat.conversation_stream'),
  ctrl.prompt,
);

//Depericated
router.get('/prompt/messages', gaurd, ctrl.getUserMessages);

router.get(
  '/prompt/messages/:id',
  gaurd,
  idValidator,
  ctrl.getUserMessagesByConversation,
);

router.post(
  '/conversation/new',
  gaurd,
  valid.startConversation,
  ctrl.startConversation,
);

router.post(
  '/generate-tags',
  gaurd,
  validate(dto.generateTagsSchema),
  ctrl.autogenerateTags,
);

router.post(
  '/conversation/new',
  gaurd,
  valid.startConversation,
  ctrl.startConversation,
);
router.post(
  '/transcribe-audio',
  gaurd,
  requireFeature('ai.transcribe_audio'),
  ctrl.transcribeAudio,
);
router.get(
  '/ephemeral-token',
  gaurd,
  requireFeature('ai.live_ephemeral_token'),
  ctrl.getEphemeralToken,
);
router.get(
  '/voices',
  gaurd,
  requireFeature('ai.voices'),
  validate(dto.aiVoicesSchema),
  ctrl.getAvailableVoices,
);
router.post(
  '/voice-preview',
  gaurd,
  requireFeature('ai.voice_preview'),
  validate(dto.aiVoicePreviewSchema),
  ctrl.getVoicePreview,
);
router.get(
  '/metrics/overview',
  gaurd,
  devOnly,
  validate(dto.aiMetricsOverviewSchema),
  ctrl.getAiMetricsOverview,
);
router.get(
  '/metrics/timeseries',
  gaurd,
  devOnly,
  validate(dto.aiMetricsTimeseriesSchema),
  ctrl.getAiMetricsTimeseries,
);
router.get(
  '/prompt-governance/status',
  gaurd,
  devOnly,
  validate(dto.aiPromptGovernanceSchema),
  ctrl.getAiPromptGovernanceStatus,
);

export default router;
