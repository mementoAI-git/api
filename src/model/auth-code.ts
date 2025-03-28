import { model, Schema } from "mongoose"

export interface IAuthCode {
  email: string
  code: string
  expires_at: string
}

const authCode = new Schema<IAuthCode>({
  email: String,
  code: String,
  expires_at: Date
}, {
  timestamps: {
    createdAt: "created_at"
  }
})

const AuthCode = model<IAuthCode>("authcode", authCode)
export default AuthCode