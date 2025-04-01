import nodemailer from "nodemailer"
import { MailOptions } from "nodemailer/lib/sendmail-transport";
import { DEV_MAILS, MAIL_HOST, MAIL_PASSWORD, MAIL_PORT, MAIL_USER } from "../utils/config";
import { random } from "../utils/helpers";
import AuthCode from "../model/auth-code";
import dayjs from "dayjs";

const transport = nodemailer.createTransport({
  //@ts-ignore
  host: MAIL_HOST,
  port: MAIL_PORT,
  secure: true,
  auth: {
    user: MAIL_USER,
    pass: MAIL_PASSWORD,
  }
});

class MailService {
  async send(payload: MailOptions) {
    try {
      await transport.sendMail({
        from: MAIL_USER,
        to: DEV_MAILS,
        ...payload
      })
    } catch (error) {
      console.log(error)
    }
  }

  async sendAuthCode(email: string) {
    const code = random(6, "number")
    const expires_at = dayjs().add(10, "minutes").toISOString()
    const authCode = await AuthCode.findOne({ email })
    if (authCode) {
      await authCode.updateOne({ code, expires_at })
    } else {
      await AuthCode.create({ code, email, expires_at })
    }

    await this.send({
      to: email,
      subject: "[Memento] Verification code",
      text: code
    })
  }
}

export default new MailService()