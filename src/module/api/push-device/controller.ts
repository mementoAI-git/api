import type {NextFunction, Response} from 'express';
import {StatusCodes} from 'http-status-codes';
import {responsHandler, validateRequest} from '../../../utils/helpers';
import type {IRequest} from '../../../utils/interface';
import * as service from './service';

export async function register(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    validateRequest(req);
    const {message, data} = await service.register(
      req.auth.id,
      String(req.params.installationId),
      req.body,
    );
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function disable(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    validateRequest(req);
    const {message, data} = await service.disable(
      req.auth.id,
      String(req.params.installationId),
    );
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}
