import {NextFunction, Response} from 'express';
import {IRequest} from '../../../utils/interface';
import {responsHandler, validateRequest} from '../../../utils/helpers';
import * as service from './service';
import {StatusCodes} from 'http-status-codes';

export async function createFeedback(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    validateRequest(req);
    console.log(req.auth, 'USER');
    const {message, data} = await service.createFeedback(req.body, req.auth.id);
    return responsHandler(res, StatusCodes.CREATED, message, data);
  } catch (error) {
    console.log(error, 'error');
    next(error);
  }
}
