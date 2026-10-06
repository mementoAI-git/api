export interface ILogin {
  email: string;
  password: string;
  remember_for_30_days?: boolean;
}

export interface IRegister extends Omit<ILogin, 'remember_for_30_days'> {
  first_name: string;
  last_name: string;
}

export interface IVerifyEmail {
  email: string;
  token: string;
}

export interface ISetPassword {
  password: string;
  token: string;
}

export interface ISendLink {
  email: string;
  type: 'reset' | 'verify';
}

export interface IOAuthAuthorization {
  code?: string;
  id_token?: string;
  user?:
    | string
    | {
        name?: {firstName?: string; lastName?: string};
      };
}

export interface IRefreshToken {
  refresh_token: string;
}

export interface IVerify2FALogin {
  two_fa_token: string;
  code: string;
}

export interface IPasskeyLoginBegin {
  email?: string;
}

export interface IPasskeyLoginComplete {
  challenge_id: string;
  response: Record<string, unknown>;
}

export interface IPasskeyRegisterComplete {
  response: Record<string, unknown>;
  device_name?: string;
}

export interface IVerifyRecoveryCode {
  email: string;
  code: string;
}
