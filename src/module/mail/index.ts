import nodemailer from "nodemailer"
import { MailOptions } from "nodemailer/lib/sendmail-transport";
import { DEV_MAILS, FRONTEND_URL, BACKEND_URL, MAIL_HOST, MAIL_PASSWORD, MAIL_PORT, MAIL_USER } from "../../utils/config";
import dayjs from "dayjs";
import { v4 as uuid } from "uuid";
import AuthCode from "../database/model/auth-code";
import * as ejs from "ejs";
import * as path from "path";

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
  private templatePath = path.join(__dirname, "template");

  private async renderTemplate(templateName: string, data: any): Promise<string> {
    const templatePath = path.join(this.templatePath, `${templateName}.ejs`);
    return ejs.renderFile(templatePath, data);
  }

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

  async sendLink(email: string, type = "reset") {
    const code = uuid()
    const expires_at = dayjs().add(10, "minutes").toISOString()

    const authCode = await AuthCode.findOne({ email })
    if (authCode) {
      await authCode.updateOne({ code, expires_at, type })
    } else {
      await AuthCode.create({ code, email, type, expires_at })
    }

    const path = type === "reset" ? "set-password" : "confirm-email"
    const link = `${FRONTEND_URL}/${path}?token=${code}&email=${email}`

    await this.send({
      to: email,
      subject: "[Memento] Verification code",
      text: link
    })
  }

  async sendBeneficiaryInvite(email: string, name: string) {
    const logoUrl = `${BACKEND_URL}/assets/images/logo-text-white.png`;

    const html = await this.renderTemplate("beneficiary-invite", {
      name,
      url: `${FRONTEND_URL}/accept-invitation?email=${email}`,
      logoUrl
    });

    await this.send({
      to: email,
      subject: "[Memento] Beneficiary Invite",
      html
    })
  }
}

export default new MailService()