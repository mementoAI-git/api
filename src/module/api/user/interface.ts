export interface ISetPassword {
  new_password: string
  old_password: string
}

export interface IVerifyTOTP {
  token: string
}