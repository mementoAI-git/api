import type {NextFunction, Request, Response} from 'express';
import {ForbiddenException} from '../utils/service-error';

/** @deprecated Legacy customer admin access is retired. Use explicit staff permissions. */
export function requireAdmin(
  _req: Request,
  _res: Response,
  next: NextFunction,
) {
  next(new ForbiddenException('Legacy administrator access is disabled'));
}
export default requireAdmin;
