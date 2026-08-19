import {NextFunction, Request, Response} from 'express';
import {StatusCodes} from 'http-status-codes';
import {
  getFiles,
  responsHandler,
  validateRequest,
  getPagination,
} from '../../../utils/helpers';
import * as service from './service';
import {IRequest} from '../../../utils/interface';
import redis from '../../../services/redis';

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
    const {message, data} = await service.getSuggestions(pagination);
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

export async function getCategories(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const {message, data} = await service.getCategories();
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
    const cacheKey = `overviewprompts:${req.auth.id}`;
    const cachedData = await redis.get(cacheKey);
    if (cachedData) {
      const {message, data} = JSON.parse(String(cachedData));
      return responsHandler(res, StatusCodes.OK, message, data);
    }

    const {message, data} = await service.getOverviewPrompts(req.auth.id);
    await redis.set(cacheKey, JSON.stringify({message, data}), {
      EX: 60 * 60 * 24,
    });

    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}
