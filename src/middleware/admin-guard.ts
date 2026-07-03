import {NextFunction, Response} from 'express';
import {IRequest} from '../utils/interface';
import {ActionNotAllowed, UnauthorizedException} from '../utils/service-error';
import User from '../module/database/model/user';
import {FEATURE_FLAGS_ADMIN_EMAILS, IS_DEV_ENV} from '../utils/config';

export default async function adminGuard(
  req: IRequest,
  _res: Response,
  next: NextFunction,
) {
  try {
    const userId = req.auth?.id;
    if (!userId) throw new UnauthorizedException('Unauthorized user');

    if (FEATURE_FLAGS_ADMIN_EMAILS.length === 0 && IS_DEV_ENV) {
      return next();
    }

    const user = await User.findById(userId).lean();
    const email = user?.email?.toLowerCase();
    if (!email || !FEATURE_FLAGS_ADMIN_EMAILS.includes(email)) {
      throw new ActionNotAllowed('Admin access required');
    }
    next();
  } catch (error) {
    next(error);
  }
}
