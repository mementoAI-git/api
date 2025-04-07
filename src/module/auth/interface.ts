export interface ILogin {
  email: string
  password: string
  remember_for_30_days?: boolean
}

export interface IVerifyEmail {
  email: string
  token: string
}

export interface ISetPassword {
  password: string
  token: string
}

export interface ISendLink {
  email: string
  type: string
}

export interface IOAuthAuthorization {
  code: string
}