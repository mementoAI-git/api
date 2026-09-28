import {NextFunction, Response} from 'express';
import {getPagination, responsHandler} from '../../../utils/helpers';
import * as service from './service';
import {IRequest} from '../../../utils/interface';
import {StatusCodes} from 'http-status-codes';
import {assertAccess} from '../billing/service';

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
    const {message, data} = await service.transcribeAudio(req.body);
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
    const {message, data} = await service.createEphemeralToken(
      req.auth.id,
      memoryId,
    );
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
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
