import {NextFunction, Response} from 'express';
import {StatusCodes} from 'http-status-codes';
import {responsHandler} from '../../../utils/helpers';
import {IRequest} from '../../../utils/interface';
import * as service from './service';

export async function listPendingInsights(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const {message, data} = await service.listPendingInsights(req.auth.id);
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function approvePendingInsight(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const {message, data} = await service.approvePendingInsight(
      String(req.params.pendingId),
      req.auth.id,
    );
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function rejectPendingInsight(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const {message, data} = await service.rejectPendingInsight(
      String(req.params.pendingId),
      req.auth.id,
    );
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}
