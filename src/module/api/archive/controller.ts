import {NextFunction, Response} from 'express';
import {StatusCodes} from 'http-status-codes';
import {responsHandler} from '../../../utils/helpers';
import {IRequest} from '../../../utils/interface';
import * as service from './service';

export async function create(req: IRequest, res: Response, next: NextFunction) {
  try {
    const result = await service.createArchiveExport(req.auth.id);
    return responsHandler(
      res,
      StatusCodes.ACCEPTED,
      result.message,
      result.data,
    );
  } catch (error) {
    return next(error);
  }
}

export async function getOne(req: IRequest, res: Response, next: NextFunction) {
  try {
    const result = await service.getArchiveExport(
      req.auth.id,
      String(req.params.id),
    );
    return responsHandler(res, StatusCodes.OK, result.message, result.data);
  } catch (error) {
    return next(error);
  }
}

export async function download(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const result = await service.getArchiveDownload(
      req.auth.id,
      String(req.params.id),
    );
    return responsHandler(res, StatusCodes.OK, result.message, result.data);
  } catch (error) {
    return next(error);
  }
}
