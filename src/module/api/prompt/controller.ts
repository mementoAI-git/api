import {consumeShuffle, getShuffleUsage} from './shuffle-usage';
import {NextFunction, Response} from 'express';
import {StatusCodes} from 'http-status-codes';
import {
  getFiles,
  responsHandler,
  validateRequest,
  getPagination,
} from '../../../utils/helpers';
import * as service from './service';
import {IRequest} from '../../../utils/interface';
import {resolveUploadReservationId} from '../file/upload-idempotency';

export async function getPrompts(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const date_key =
      typeof req.query?.date_key === 'string' ? req.query.date_key : undefined;
    const {message, data} = await service.getPrompts(req.auth.id, date_key);

    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function getUserPrompt(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const {message, data} = await service.getUserPromptResponse(
      String(req.params.id),
      req.auth.id,
    );
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function replyPrompt(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    validateRequest(req);
    const files = getFiles(req);
    const {message, data} = await service.replyPrompt(
      req.body,
      req.auth.id,
      files,
      resolveUploadReservationId(
        req.header('Idempotency-Key'),
        req.context?.requestId,
        'prompt:reply',
      ),
    );
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function getSuggestions(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const pagination = getPagination(req);
    const {message, data} = await service.getSuggestions(
      pagination,
      req.auth.id,
    );
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function getPromptDetails(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const {message, data} = await service.getPromptDetails(
      String(req.params.id),
      req.auth.id,
    );
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function getPromptsByCategory(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const {message, data} = await service.getPromptsByCategory(
      String(req.params.id),
      req.auth.id,
      getPagination(req),
    );
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function getExploreCategories(
  _req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const {message, data} = await service.getExploreCategories();
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function setExploreQuestionFeedback(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    validateRequest(req);
    const {message, data} = await service.setExploreQuestionFeedback(
      String(req.params.id),
      req.body,
      req.auth.id,
    );
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function getOverviewPrompts(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const {message, data} = await service.getOverviewPrompts(req.auth.id);

    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function getPromptShuffleUsage(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    return responsHandler(
      res,
      StatusCodes.OK,
      'Shuffle allowance retrieved',
      await getShuffleUsage(req.auth.id),
    );
  } catch (error) {
    next(error);
  }
}

export async function shufflePrompts(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const data = await consumeShuffle(req.auth.id);
    return responsHandler(
      res,
      StatusCodes.OK,
      data.allowed
        ? 'Reflection shuffle allowed'
        : 'Daily shuffle limit reached',
      data,
    );
  } catch (error) {
    next(error);
  }
}

export async function openReflectionConversation(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    validateRequest(req);
    const {message, data} = await service.openReflectionConversation(
      req.auth.id,
      req.body,
    );
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}
