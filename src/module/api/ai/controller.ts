import {
  confirmChatAction as confirmChatActionService,
  undoChatAction as undoChatActionService,
} from './chat-tools/confirm';
import {chatFeaturesFrom} from './chat-features';
import {previewLink} from '../../../services/link-preview';
import {digitalMindNameFromHeader} from '../../../utils/ai-prompt/digital-mind';
import {getTranscriptionInput} from './transcription-input';
import {NextFunction, Response} from 'express';
import {getPagination, responsHandler} from '../../../utils/helpers';
import * as service from './service';
import {IRequest} from '../../../utils/interface';
import {StatusCodes} from 'http-status-codes';
import {assertAccess} from '../billing/service';
import * as voiceTurns from './voice/turns';
import {searchMemoriesForVoice} from './voice/memory-search';
import {validTimeZone} from './voice/local-time';
import {UnknownVoiceToolError, runVoiceServerTool} from './voice/server-tools';
import {parseVoiceClientCapabilities} from './live-session-config';
import {
  endVoiceCall as endCall,
  getVoiceCallSummary,
  saveVoiceCallRecording as saveRecording,
} from './voice/calls';
import {
  NotFoundException,
  BadRequestException,
} from '../../../utils/service-error';
import {StepTimer} from '../../../utils/step-timer';
import logger from '../../../utils/logger';

export async function autogenerateTags(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const {message, data} = await service.autogenerateTags(req.body);
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function autogenerateStoryTitle(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const {message, data} = await service.autogenerateStoryTitle(req.body);
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

/**
 * A frame sent before the reply's words, to apps that asked for status
 * lines: a record separator, JSON, a newline. Once one is sent the headers
 * are out, so the model label travels as a frame too.
 */
function writeFrame(res: Response, data: Record<string, string>) {
  if (!res.headersSent) {
    // No Content-Type, like the reply itself: a compressible type would make
    // the compression middleware buffer the stream.
    res.setHeader('Cache-Control', 'no-cache');
    res.flushHeaders();
  }
  res.write(`\u001e${JSON.stringify(data)}\n`);
  (res as Response & {flush?: () => void}).flush?.();
}

export async function prompt(req: IRequest, res: Response, next: NextFunction) {
  const features = chatFeaturesFrom(name => req.get(name));
  try {
    const response = await service.prompt(
      {
        ...req.body,
        digitalMindName: digitalMindNameFromHeader(
          req.get('x-memento-mind-name'),
        ),
      },
      req.auth.id,
      features,
      features.status
        ? text => {
            if (!res.writableEnded) writeFrame(res, {status: text});
          }
        : undefined,
    );
    if (response.modelLabel) {
      if (!res.headersSent) res.setHeader('x-ai-model', response.modelLabel);
      else writeFrame(res, {model: response.modelLabel});
    }
    return await service.handleStreaming(
      req.auth.id,
      req.body.memory,
      response.stream,
      res,
      response.modelLabel,
      {
        userText: response.userText,
        userMessageSaved: response.userMessageSaved,
        links: response.links,
        confirmations: response.confirmations,
        dones: response.dones,
      },
    );
  } catch (error) {
    // A status line already went out, so the reply has begun: end it plainly.
    if (res.headersSent) {
      res.write(
        `ERROR: ${(error as Error)?.message || 'Something went wrong'}`,
      );
      res.end();
      return;
    }
    next(error);
  }
}

export async function getUserMessages(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const {message, data} = await service.getUserMessages(
      getPagination(req),
      req.auth.id,
    );
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function getUserMessagesByConversation(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const {message, data} = await service.getUserMessagesByConversation(
      String(req.params.id),
      getPagination(req),
      req.auth.id,
    );

    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function startConversation(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const {message, data} = await service.startConversation(
      {
        ...req.body,
        digitalMindName: digitalMindNameFromHeader(
          req.get('x-memento-mind-name'),
        ),
      },
      req.auth.id,
    );
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function transcribeAudio(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const {message, data} = await service.transcribeAudio(
      getTranscriptionInput(req.body, req.file),
      req.auth.id,
    );
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function getEphemeralToken(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  const timer = new StepTimer();
  try {
    // The plan check runs alongside preparing the session (both wait on the
    // database); the session is only returned once access is confirmed.
    const access = timer.time('access', () =>
      assertAccess(req.auth.id, 'voice_mode'),
    );
    for (const flag of ['shared_space', 'share_inputs']) {
      if (
        req.query[flag] !== undefined &&
        !['true', 'false'].includes(String(req.query[flag]))
      )
        throw new BadRequestException(`Invalid ${flag}`);
    }
    if (
      req.query.person_id !== undefined &&
      (typeof req.query.person_id !== 'string' ||
        !/^[a-fA-F0-9]{24}$/.test(req.query.person_id))
    )
      throw new BadRequestException('Invalid connection');
    const memoryId =
      typeof req.query.memory_id === 'string' && req.query.memory_id.trim()
        ? req.query.memory_id.trim()
        : undefined;
    const resumeHandle =
      typeof req.query.resume_handle === 'string' &&
      req.query.resume_handle.trim() &&
      req.query.resume_handle.length <= 4096
        ? req.query.resume_handle.trim()
        : undefined;
    const deviceModel =
      typeof req.query.device_model === 'string'
        ? req.query.device_model.trim().slice(0, 100)
        : undefined;
    const timeZone = validTimeZone(req.query.timezone);
    const {memoryTool, callActions, serverTools, screenControl, screenFields} =
      parseVoiceClientCapabilities(req.query.capabilities);
    const prepared = service.createEphemeralToken(
      req.auth.id,
      memoryId,
      resumeHandle,
      {
        connectionSharedSpace: req.query.shared_space === 'true',
        connectionShareInputs: req.query.share_inputs === 'true',
        connectionPersonId:
          typeof req.query.person_id === 'string'
            ? req.query.person_id
            : undefined,
        deviceModel,
        digitalMindName: digitalMindNameFromHeader(
          req.get('x-memento-mind-name'),
        ),
        memoryTool,
        callActions,
        serverTools,
        screenControl,
        screenFields,
        timeZone,
        timer,
      },
    );
    // If access is refused, the prepared session is dropped unseen.
    prepared.catch(() => {});
    await access;
    const {message, data} = await prepared;
    logger.info(
      {userId: req.auth.id, ms: timer.total(), steps: timer.steps},
      'Voice session prepared',
    );
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function recordVoiceTurns(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const {message, data} = await voiceTurns.recordVoiceTurns(
      req.auth.id,
      req.body,
    );
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function endVoiceCall(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const {message, data} = await endCall(
      req.auth.id,
      String(req.params.sessionId),
      req.body,
    );
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function summarizeVoiceCall(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const {message, data} = await getVoiceCallSummary(
      req.auth.id,
      String(req.params.sessionId),
    );
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function saveVoiceCallRecording(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const {message, data} = await saveRecording(
      req.auth.id,
      String(req.params.sessionId),
      req.body,
    );
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function searchVoiceMemories(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    await assertAccess(req.auth.id, 'voice_mode');
    const result = await searchMemoriesForVoice(req.auth.id, req.body.query, {
      also: req.body.also,
    });
    return responsHandler(res, StatusCodes.OK, 'Memory search complete', {
      result,
    });
  } catch (error) {
    next(error);
  }
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, 200)
    : undefined;
}

/** The Undo button under something chat did. */
export async function undoChatAction(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const {message, data} = await undoChatActionService(
      req.auth.id,
      String(req.body.memory),
      String(req.body.action),
    );
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

/** The Confirm button on a chat confirmation card. */
export async function confirmChatAction(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const {message, data} = await confirmChatActionService(
      req.auth.id,
      String(req.params.name),
      (req.body.args ?? {}) as Record<string, unknown>,
      String(req.body.memory),
    );
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

/** Runs a server-side voice tool the app forwarded from Gemini Live. */
export async function runVoiceTool(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    await assertAccess(req.auth.id, 'voice_mode');
    const outcome = await runVoiceServerTool(
      req.auth.id,
      String(req.params.name),
      (req.body.args ?? {}) as Record<string, unknown>,
      {
        callId: stringOrUndefined(req.body.call_id),
        sessionId: stringOrUndefined(req.body.session_id),
      },
    );
    return responsHandler(res, StatusCodes.OK, 'Voice tool complete', outcome);
  } catch (error) {
    if (error instanceof UnknownVoiceToolError) {
      return next(new NotFoundException('Unknown voice tool', null));
    }
    next(error);
  }
}

export async function getAiMetricsOverview(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const hours = Number(req.query.hours || 24);
    const {message, data} = await service.getAiMetricsOverview(hours);
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function getAiMetricsTimeseries(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const hours = Number(req.query.hours || 24);
    const intervalMinutes = Number(req.query.interval_minutes || 60);
    const {message, data} = await service.getAiMetricsTimeseries(
      hours,
      intervalMinutes,
    );
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function getAiPromptGovernanceStatus(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const {message, data} = await service.getAiPromptGovernanceStatus();
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function getAvailableVoices(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const provider =
      typeof req.query.provider === 'string' ? req.query.provider : undefined;
    const {message, data} = await service.getAvailableVoices(provider);
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

/** Title, site, preview image and icon for a link shown in chat. */
export async function getLinkPreview(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const data = await previewLink(String(req.query.url));
    return responsHandler(res, StatusCodes.OK, 'Link preview', data);
  } catch (error) {
    next(error);
  }
}

export async function getVoicePreview(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const {message, data} = await service.getVoicePreview(req.body);
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function getSpokenReply(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  const controller = new AbortController();
  const onClose = () => {
    if (!res.writableEnded) controller.abort();
  };
  res.once('close', onClose);
  try {
    const {message, data} = await service.getSpokenReply(
      req.auth.id,
      req.body.text,
      controller.signal,
    );
    res.setHeader('Cache-Control', 'no-store');
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    if (!controller.signal.aborted) next(error);
  } finally {
    res.off('close', onClose);
  }
}
