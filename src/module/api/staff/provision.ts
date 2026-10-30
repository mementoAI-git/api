import bcrypt from 'bcryptjs';
import speakeasy from 'speakeasy';
import {z} from 'zod';
import StaffAccount, {
  STAFF_PERMISSIONS,
} from '../../database/model/staff-account';
import StaffSession from '../../database/model/staff-session';
import StaffAudit from '../../database/model/staff-audit';
import {
  BadRequestException,
  NotFoundException,
} from '../../../utils/service-error';
import {encryptTotp} from './crypto';

const inputSchema = z
  .object({
    operation: z.enum(['create', 'reset', 'disable']),
    email: z.string().trim().toLowerCase().email().max(254),
    password: z
      .string()
      .min(15)
      .refine(value => Buffer.byteLength(value, 'utf8') <= 72)
      .optional(),
    totpSecret: z
      .string()
      .regex(/^[A-Z2-7]{32,128}$/)
      .optional(),
    code: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
    permissions: z.array(z.enum(STAFF_PERMISSIONS)).optional(),
  })
  .strict();

// Operator-only entry point: never expose provisioning through a public route.
export async function provisionStaff(input: unknown) {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success)
    throw new BadRequestException('Invalid staff provisioning input');
  const data = parsed.data;
  if (data.operation === 'disable') {
    const staff = await StaffAccount.findOneAndUpdate(
      {email: data.email},
      {$set: {enabled: false}, $inc: {credential_version: 1}},
    );
    if (!staff) throw new NotFoundException('Staff account not found');
    await StaffSession.deleteMany({staff_id: staff._id});
    await StaffAudit.create({
      staff_id: staff.id,
      action: 'disabled',
      actor: 'operator-cli',
    });
    return;
  }
  if (
    !data.password ||
    !data.totpSecret ||
    !data.code ||
    !data.permissions?.length
  ) {
    throw new BadRequestException(
      'Password, authenticator secret, current code and permissions are required',
    );
  }
  if (
    data.permissions.includes('flags:write') &&
    !data.permissions.includes('flags:read')
  ) {
    throw new BadRequestException('Flag writers also require flags:read');
  }
  const time = Math.floor(Date.now() / 1000);
  const verified = speakeasy.totp.verifyDelta({
    secret: data.totpSecret,
    encoding: 'base32',
    token: data.code,
    window: 1,
    time,
  });
  if (!verified)
    throw new BadRequestException(
      'Authenticator enrollment could not be verified',
    );
  const credentials = {
    password_hash: await bcrypt.hash(data.password, 12),
    totp_encrypted: encryptTotp(data.totpSecret),
    last_totp_step: Math.floor(time / 30) + verified.delta,
    permissions: data.permissions,
    enabled: true,
    login_attempts: 0,
    login_window_end: new Date(0),
  };
  let staff;
  if (data.operation === 'create') {
    if (await StaffAccount.exists({email: data.email}))
      throw new BadRequestException('Staff account already exists');
    staff = await StaffAccount.create({email: data.email, ...credentials});
  } else {
    staff = await StaffAccount.findOneAndUpdate(
      {email: data.email},
      {$set: credentials, $inc: {credential_version: 1}},
      {new: true},
    );
    if (!staff) throw new NotFoundException('Staff account not found');
    await StaffSession.deleteMany({staff_id: staff._id});
  }
  await StaffAudit.create({
    staff_id: staff.id,
    action: data.operation,
    actor: 'operator-cli',
  });
}
