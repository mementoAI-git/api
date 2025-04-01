import { body, param } from "express-validator";
import { OAUTH_PROVIDERS } from "../../utils/constant";

const providerValidator = param("provider")
  .notEmpty().withMessage("Provider is required")
  .isIn(Object.keys(OAUTH_PROVIDERS))
  .withMessage("Provider is not supported")

export const emailValidator = body("email")
  .notEmpty().withMessage("Email address is required")
  .isEmail().withMessage("Invalid email address")

export default {
  generateOauthUrl: providerValidator,
  authorization: [
    providerValidator,
    body("code").notEmpty().withMessage("Authorization code is required")
  ],
  login: [
    emailValidator,
    body("password")
      .notEmpty().withMessage("Password is required"),
    body("remember_for_30_days")
      .optional()
      .default(false)
      .toBoolean()
  ],
  register: [
    emailValidator,
    body("password")
      .notEmpty().withMessage("Password is required")
      .isStrongPassword().withMessage("Password must be strong"),
  ],
  sendAuthCode: emailValidator,
  verifyCode: [
    emailValidator,
    body("code").notEmpty().withMessage("Verification code is required")
  ],

}