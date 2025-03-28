import { NextFunction, Request, Response } from 'express';
import { UnauthorizedException } from '../utils/service-error';
import { verifyAccessToken } from '../utils/helpers';

export default async function (req: Request | any, res: Response, next: NextFunction) {
  try {
    const token = req.header('authorization');
    if (!token || !token.startsWith('Bearer')) {
      throw new UnauthorizedException('Token is required');
    }

    req.auth = verifyAccessToken(token.replace('Bearer ', ''));

    next();
  } catch (err) {
    next(err);
  }
}
