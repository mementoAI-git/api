import {model, Schema} from 'mongoose';

export interface IAuthCode {
  email: string;
  code: string;
  type: string;
  expires_at: string;
}

const authCode = new Schema<IAuthCode>(
  {
    email: {
      type: String,
      default: null,
    },
    code: {
      type: String,
      index: true,
    },
    type: {
      type: String,
      index: true,
    },
    expires_at: Date,
  },
  {
    timestamps: {
      createdAt: 'created_at',
    },
  },
);

const AuthCode = model<IAuthCode>('authcode', authCode);
export default AuthCode;
