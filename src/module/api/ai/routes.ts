import {Router, type IRouter} from 'express';
import fileUploadMiddleware from '../../../middleware/file-upload';
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
  '/generate-story-title',
  gaurd,
  validate(dto.generateStoryTitleSchema),
  ctrl.autogenerateStoryTitle,
);

router.post(
  '/transcribe-audio',
  gaurd,
  requireFeature('ai.transcribe_audio'),
  fileUploadMiddleware.single('file'),
  ctrl.transcribeAudio,
);
router.get(
  '/ephemeral-token',
  gaurd,
  requireFeature('ai.live_ephemeral_token'),
  ctrl.getEphemeralToken,
);
router.post(
  '/voice/turns',
  gaurd,
  validate(dto.voiceTurnsSchema),
  ctrl.recordVoiceTurns,
);
router.post(
  '/voice/memory-search',
  gaurd,
  validate(dto.voiceMemorySearchSchema),
  ctrl.searchVoiceMemories,
);
router.post(
  '/voice/calls/:sessionId/end',
  gaurd,
  validate(dto.voiceCallEndSchema),
  ctrl.endVoiceCall,
);
router.post(
  '/voice/calls/:sessionId/summary',
  gaurd,
  validate(dto.voiceCallSummarySchema),
  ctrl.summarizeVoiceCall,
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
