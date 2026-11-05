import {NextFunction, Response} from 'express';
import {StatusCodes} from 'http-status-codes';
import {responsHandler} from '../../../utils/helpers';
import {IRequest} from '../../../utils/interface';
import * as observations from './observations';
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

function observationParam(req: IRequest): string {
  return String(req.params.observationId);
}

export async function listObservations(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const {message, data} = await observations.listObservations(req.auth.id);
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function getObservationSources(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const {message, data} = await observations.getObservationSources(
      req.auth.id,
      observationParam(req),
    );
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function updateObservation(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const {message, data} = await observations.updateObservation(
      req.auth.id,
      observationParam(req),
      req.body.content,
    );
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function forgetObservation(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const {message, data} = await observations.forgetObservation(
      req.auth.id,
      observationParam(req),
    );
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}
