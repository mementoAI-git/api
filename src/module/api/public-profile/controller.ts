import {NextFunction, Request, Response} from 'express';
import type {IRequest} from '../../../utils/interface';
import {responsHandler} from '../../../utils/helpers';
import {FRONTEND_URL} from '../../../utils/config';
import {InternalServerErrorException} from '../../../utils/service-error';
import * as service from './service';
import {PROFILE_CSP, renderPublicProfile} from './view';

export async function publish(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const data = await service.publishProfile(req.auth.id);
    return responsHandler(res, 200, 'Profile link ready', data);
  } catch (error) {
    return next(error);
  }
}
export async function revoke(req: IRequest, res: Response, next: NextFunction) {
  try {
    await service.revokeProfile(req.auth.id);
    return responsHandler(res, 200, 'Profile link revoked');
  } catch (error) {
    return next(error);
  }
}
export async function view(req: Request, res: Response, next: NextFunction) {
  try {
    const token = typeof req.params.token === 'string' ? req.params.token : '';
    const profile = await service.getPublicProfile(token);
    if (!FRONTEND_URL)
      throw new InternalServerErrorException(
        'Profile sharing is not configured',
      );
    res.setHeader('Content-Security-Policy', PROFILE_CSP);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    return res.type('html').send(renderPublicProfile(profile, FRONTEND_URL));
  } catch (error) {
    return next(error);
  }
}
