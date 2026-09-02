import type {JwtPayload} from 'jsonwebtoken';
import type {PublicUser} from './public-user';

export type SessionClaims = JwtPayload & {
  id: string;
  sid?: string;
  sv?: number;
  type?: 'refresh';
};

export type SessionPayload = {
  access_token: string;
  refresh_token: string;
  access_expires_at: string;
  /** Compatibility alias retained for existing clients. */
  expires_at: string;
  refresh_expires_at: string;
  user: PublicUser;
  onboarding_status: string;
};
