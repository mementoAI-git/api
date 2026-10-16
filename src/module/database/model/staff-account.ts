import {model, Schema} from 'mongoose';

export const STAFF_PERMISSIONS = [
  'flags:read',
  'flags:write',
  'operations:read',
  'accounts:read',
] as const;
export type StaffPermission = (typeof STAFF_PERMISSIONS)[number];
const schema = new Schema(
  {
    email: {type: String, required: true, unique: true},
    password_hash: {type: String, required: true, select: false},
    totp_encrypted: {type: String, required: true, select: false},
    last_totp_step: {type: Number, default: -1, select: false},
    permissions: [{type: String, enum: STAFF_PERMISSIONS}],
    enabled: {type: Boolean, default: true},
    credential_version: {type: Number, default: 1},
    login_attempts: {type: Number, default: 0},
    login_window_end: {type: Date, default: () => new Date(0)},
  },
  {timestamps: true},
);
export default model('staff_account', schema);
