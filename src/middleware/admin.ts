import {NextFunction, Response} from 'express';
import User from '../module/database/model/user';
import {FEATURE_FLAGS_ADMIN_EMAILS} from '../utils/config';
import {IRequest} from '../utils/interface';
import {ActionNotAllowed, UnauthorizedException} from '../utils/service-error';

export async function requireAdmin(
  req: IRequest,
  _res: Response,
  next: NextFunction,
) {
  try {
    const userId = req.auth?.id;
    if (!userId) throw new UnauthorizedException('Unauthorized user');

    const user = await User.findOne({
      _id: userId,
      deleted: {$ne: true},
    })
      .select('email')
      .lean();
    const email = user?.email?.trim().toLowerCase();
    if (!email || !FEATURE_FLAGS_ADMIN_EMAILS.includes(email)) {
      throw new ActionNotAllowed('Admin access required');
    }

    next();
  } catch (error) {
    next(error);
  }
}

export default requireAdmin;
