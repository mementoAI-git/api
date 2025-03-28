export interface ILogin {
  email: string
  password: string
  remember_for_30_days?: boolean
}

export interface IVerifyCode {
  email: string
  code: string
}

export interface IOAuthAuthorization {
  code: string
}