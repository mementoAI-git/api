import type {NextFunction, Response} from 'express';
import {responsHandler} from '../../../utils/helpers';
import {
  STAFF_COOKIE,
  staffCookieOptions,
  staffToken,
  type StaffRequest,
} from '../../../middleware/staff';
import {loginStaff, logoutStaff, SESSION_TTL} from './service';

export async function login(
  req: StaffRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const result = await loginStaff(
      req.body.email,
      req.body.password,
      req.body.code,
    );
    res.cookie(STAFF_COOKIE, result.token, {
      ...staffCookieOptions(),
      maxAge: SESSION_TTL,
    });
    return responsHandler(res, 200, 'Signed in', {
      ...result.staff,
      expiresAt: result.expiresAt,
    });
  } catch (error) {
    next(error);
  }
}
export function session(req: StaffRequest, res: Response) {
  return responsHandler(res, 200, 'Staff session', req.staff);
}
export async function logout(
  req: StaffRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    await logoutStaff(staffToken(req), req.staff!.id);
    res.clearCookie(STAFF_COOKIE, staffCookieOptions());
    return responsHandler(res, 200, 'Signed out');
  } catch (error) {
    next(error);
  }
}
