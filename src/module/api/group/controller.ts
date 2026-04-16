import {NextFunction, Response} from 'express';
import {StatusCodes} from 'http-status-codes';
import {
  getPagination,
  responsHandler,
  validateRequest,
} from '../../../utils/helpers';
import * as service from './service';
import {IRequest} from '../../../utils/interface';
import {SearchQuery} from './dto';

export async function create(req: IRequest, res: Response, next: NextFunction) {
  try {
    validateRequest(req);
    const {message, data} = await service.create(req.body, req.auth!.id);
    return responsHandler(res, StatusCodes.CREATED, message, data);
  } catch (error) {
    next(error);
  }
}

export async function list(req: IRequest, res: Response, next: NextFunction) {
  try {
    const {message, data} = await service.list(
      getPagination(req),
      req.auth!.id,
    );
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function getOne(req: IRequest, res: Response, next: NextFunction) {
  try {
    const {message, data} = await service.getOne(
      String(req.params.id),
      req.auth!.id,
    );
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function update(req: IRequest, res: Response, next: NextFunction) {
  try {
    validateRequest(req);
    const {message, data} = await service.update(
      String(req.params.id),
      req.body,
      req.auth!.id,
    );
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function del(req: IRequest, res: Response, next: NextFunction) {
  try {
    const {message, data} = await service.del(
      String(req.params.id),
      req.auth!.id,
    );
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function addMembers(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    validateRequest(req);
    const {message, data} = await service.addMembers(
      String(req.params.id),
      req.body.beneficiaryIds,
      req.auth!.id,
    );
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function removeMember(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const {message, data} = await service.removeMember(
      String(req.params.id),
      String(req.params.beneficiaryId),
      req.auth!.id,
    );
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function search(req: IRequest, res: Response, next: NextFunction) {
  try {
    const {message, data} = await service.search(
      req.query as SearchQuery,
      req.auth!.id,
    );
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}
