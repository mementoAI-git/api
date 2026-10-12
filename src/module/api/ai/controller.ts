import {getTranscriptionInput} from './transcription-input';
import {NextFunction, Response} from 'express';
import {getPagination, responsHandler} from '../../../utils/helpers';
import * as service from './service';
import {IRequest} from '../../../utils/interface';
import {StatusCodes} from 'http-status-codes';
import {assertAccess} from '../billing/service';
import * as voiceTurns from './voice/turns';
import {searchMemoriesForVoice} from './voice/memory-search';
import {UnknownVoiceToolError, runVoiceServerTool} from './voice/server-tools';
import {parseVoiceClientCapabilities} from './live-session-config';
import {endVoiceCall as endCall, getVoiceCallSummary} from './voice/calls';
import {NotFoundException} from '../../../utils/service-error';

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

export async function prompt(req: IRequest, res: Response, next: NextFunction) {
  try {
    const response = await service.prompt(req.body, req.auth.id);
    if (response.modelLabel) {
      res.setHeader('x-ai-model', response.modelLabel);
    }
    return await service.handleStreaming(
      req.auth.id,
      req.body.memory,
      response.stream,
      res,
      response.modelLabel,
    );
  } catch (error) {
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
      req.body,
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
  try {
    await assertAccess(req.auth.id, 'voice_mode');
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
    const {memoryTool, callActions, serverTools, screenControl} =
      parseVoiceClientCapabilities(req.query.capabilities);
    const {message, data} = await service.createEphemeralToken(
      req.auth.id,
      memoryId,
      resumeHandle,
      {
        deviceModel,
        memoryTool,
        callActions,
        serverTools,
        screenControl,
      },
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

export async function searchVoiceMemories(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    await assertAccess(req.auth.id, 'voice_mode');
    const result = await searchMemoriesForVoice(req.auth.id, req.body.query);
    return responsHandler(res, StatusCodes.OK, 'Memory search complete', {
      result,
    });
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
