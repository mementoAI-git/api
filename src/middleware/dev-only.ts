import {NextFunction, Request, Response} from 'express';
import {ForbiddenException} from '../utils/service-error';
import {IS_DEV_ENV} from '../utils/config';

export default function devOnly(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (!IS_DEV_ENV) {
    return next(
      new ForbiddenException(
        'This endpoint is available only in local/dev environments.',
      ),
    );
  }
  return next();
}
