import {randomBytes} from 'crypto';
import bcrypt from 'bcryptjs';
import speakeasy from 'speakeasy';
import StaffAccount from '../../database/model/staff-account';
import StaffSession from '../../database/model/staff-session';
import StaffAudit from '../../database/model/staff-audit';
import {UnauthorizedException} from '../../../utils/service-error';
import {decryptTotp, tokenHash} from './crypto';

export const SESSION_TTL = 30 * 60 * 1000;
// Match password work for unknown accounts without retaining any real credential.
const dummyHash = bcrypt.hashSync('unused-staff-login-timing-value', 12);
export async function loginStaff(
  email: string,
  password: string,
  code: string,
) {
  const now = new Date();
  // Fixed attempt windows persist across instances, with an atomic reservation per attempt.
  await StaffAccount.updateOne(
    {email, login_window_end: {$lte: now}},
    {
      $set: {
        login_attempts: 0,
        login_window_end: new Date(now.getTime() + 15 * 60 * 1000),
      },
    },
  );
  const staff = await StaffAccount.findOneAndUpdate(
    {email, enabled: true, login_attempts: {$lt: 5}},
    {$inc: {login_attempts: 1}},
    {new: true},
  ).select('+password_hash +totp_encrypted +last_totp_step');
  const passwordValid = await bcrypt.compare(
    password,
    staff?.password_hash || dummyHash,
  );
  if (!staff || !passwordValid)
    throw new UnauthorizedException(
      'Unable to sign in. Check your credentials or try again later.',
    );
  const time = Math.floor(Date.now() / 1000);
  const verified = speakeasy.totp.verifyDelta({
    secret: decryptTotp(staff.totp_encrypted),
    encoding: 'base32',
    token: code,
    window: 1,
    time,
  });
  const step = verified ? Math.floor(time / 30) + verified.delta : -1;
  if (!verified || step <= staff.last_totp_step)
    throw new UnauthorizedException(
      'Unable to sign in. Check your credentials or try again later.',
    );
  const consumed = await StaffAccount.updateOne(
    {
      _id: staff._id,
      enabled: true,
      credential_version: staff.credential_version,
      last_totp_step: {$lt: step},
    },
    {$set: {last_totp_step: step, login_attempts: 0}},
  );
  if (consumed.modifiedCount !== 1)
    throw new UnauthorizedException(
      'Unable to sign in. Check your credentials or try again later.',
    );
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL);
  await StaffSession.create({
    staff_id: staff._id,
    credential_version: staff.credential_version,
    token_hash: tokenHash(token),
    expires_at: expiresAt,
  });
  await StaffAudit.create({
    staff_id: staff.id,
    action: 'login',
    actor: `staff:${staff.id}`,
  });
  return {
    token,
    staff: {id: staff.id, email: staff.email, permissions: staff.permissions},
    expiresAt,
  };
}
export async function logoutStaff(token: string, staffId: string) {
  await StaffSession.deleteOne({token_hash: tokenHash(token)});
  await StaffAudit.create({
    staff_id: staffId,
    action: 'logout',
    actor: `staff:${staffId}`,
  });
}
