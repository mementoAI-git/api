import {NextFunction, Response} from 'express';
import {IRequest} from '../../../utils/interface';
import {responsHandler} from '../../../utils/helpers';
import * as service from './service';

export async function list(req: IRequest, res: Response, next: NextFunction) {
  try {
    return responsHandler(
      res,
      200,
      'People retrieved',
      await service.list(req.auth.id),
    );
  } catch (error) {
    next(error);
  }
}

export async function space(req: IRequest, res: Response, next: NextFunction) {
  try {
    const data = await service.space(String(req.params.personId), req.auth.id, {
      page: Number(req.query.page),
      limit: Number(req.query.limit),
      filter: String(req.query.filter),
    });
    return responsHandler(res, 200, 'Shared space retrieved', data);
  } catch (error) {
    next(error);
  }
}
