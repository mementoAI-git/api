import {NextFunction, Request, Response} from 'express';
import {UnauthorizedException} from '../utils/service-error';
import {verifyAccessToken} from '../utils/helpers';
import type {IRequest} from '../utils/interface';
import {assertActiveSecurityState} from '../module/api/auth/security-state';

export default async function (
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  try {
    const token = req.header('authorization');
    if (!token || !token.startsWith('Bearer')) {
      throw new UnauthorizedException('Token is required');
    }

    const claims = verifyAccessToken(token.replace('Bearer ', ''));
    await assertActiveSecurityState(claims);
    (req as IRequest).auth = claims;

    next();
  } catch (err) {
    next(err);
  }
}
