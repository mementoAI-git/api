import type {NextFunction, Request, Response} from 'express';
import StaffAccount, {
  type StaffPermission,
} from '../module/database/model/staff-account';
import StaffSession from '../module/database/model/staff-session';
import {tokenHash} from '../module/api/staff/crypto';
import {
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '../utils/service-error';
import {staffConfig} from '../utils/config';
import type {IRequest} from '../utils/interface';

export const STAFF_COOKIE = 'memento_staff';
export const staffCookieOptions = () => ({
  httpOnly: true,
  secure: staffConfig().secureCookies,
  sameSite: 'strict' as const,
  path: '/staff',
});
export type StaffRequest = IRequest & {
  staff?: {id: string; email: string; permissions: string[]; expiresAt: Date};
};
export function staffToken(req: Request) {
  const values = (req.headers.cookie || '')
    .split(';')
    .map(value => value.trim())
    .filter(value => value.startsWith(`${STAFF_COOKIE}=`));
  if (values.length !== 1) return '';
  const token = values[0].slice(STAFF_COOKIE.length + 1);
  return /^[a-f\d]{64}$/.test(token) ? token : '';
}
export function staffBoundary(req: Request, res: Response, next: NextFunction) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const origin = staffConfig().origin;
    if (
      !origin ||
      !/^[a-f\d]{64}$/i.test(staffConfig().totpKey) ||
      new URL(origin).origin !== origin ||
      (staffConfig().secureCookies && !origin.startsWith('https://'))
    ) {
      throw new ServiceUnavailableException(
        'Staff authentication is not configured',
      );
    }
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      req.get('origin') !== origin
    ) {
      throw new ForbiddenException('Staff request origin is not allowed');
    }
    next();
  } catch (error) {
    next(error);
  }
}
export function requireStaff(permission?: StaffPermission) {
  return async (req: StaffRequest, _res: Response, next: NextFunction) => {
    try {
      const token = staffToken(req);
      if (!token) throw new UnauthorizedException('Staff sign-in required');
      const session = await StaffSession.findOne({
        token_hash: tokenHash(token),
        expires_at: {$gt: new Date()},
      }).lean();
      if (!session) throw new UnauthorizedException('Staff session expired');
      const staff = await StaffAccount.findOne({
        _id: session.staff_id,
        enabled: true,
        credential_version: session.credential_version,
      }).lean();
      if (!staff) throw new UnauthorizedException('Staff session expired');
      if (permission && !staff.permissions.includes(permission))
        throw new ForbiddenException('Staff permission required');
      req.staff = {
        id: String(staff._id),
        email: staff.email,
        permissions: staff.permissions,
        expiresAt: session.expires_at,
      };
      // Reused flag controllers record a namespaced staff identity, never a customer ID.
      req.auth = {id: `staff:${staff._id}`};
      next();
    } catch (error) {
      next(error);
    }
  };
}
