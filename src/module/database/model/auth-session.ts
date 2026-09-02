import {model, Schema} from 'mongoose';
import type {MementoClient} from '../../../contracts/response';

export interface IAuthSession {
  session_id: string;
  user_id: string;
  refresh_token_hash: string;
  installation_id?: string;
  client: MementoClient;
  created_at: Date;
  updated_at: Date;
  last_seen_at: Date;
  expires_at: Date;
  revoked_at?: Date | null;
}

const authSessionSchema = new Schema<IAuthSession>(
  {
    session_id: {type: String, required: true, unique: true},
    user_id: {type: String, required: true, index: true},
    refresh_token_hash: {type: String, required: true, select: false},
    installation_id: {type: String},
    client: {
      type: String,
      enum: ['web', 'ios', 'android', 'legacy-unknown'],
      required: true,
    },
    last_seen_at: {type: Date, required: true},
    expires_at: {type: Date, required: true},
    revoked_at: {type: Date, default: null},
  },
  {
    timestamps: {createdAt: 'created_at', updatedAt: 'updated_at'},
  },
);

authSessionSchema.index({expires_at: 1}, {expireAfterSeconds: 0});
authSessionSchema.index({user_id: 1, revoked_at: 1});

const AuthSession = model<IAuthSession>('auth_session', authSessionSchema);
export default AuthSession;
