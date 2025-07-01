import { NextFunction, Request, Response } from 'express';
import { verifyAccessToken } from '../utils/helpers';

export default function checkGuard(req: Request | any, res: Response, next: NextFunction) {
  const token = req.header('authorization');
  if (token && token.startsWith('Bearer ')) {
    try {
      req.auth = verifyAccessToken(token.replace('Bearer ', ''));
    } catch (err) {
      req.auth = null;
    }
  } else {
    req.auth = null;
  }
  next();
} 