import { body, param } from "express-validator";
import { OAUTH_PROVIDERS } from "../../../utils/constant";

const providerValidator = param("provider")
  .notEmpty().withMessage("Provider is required")
  .isIn(Object.keys(OAUTH_PROVIDERS))
  .withMessage("Provider is not supported")

export const emailValidator = body("email")
  .notEmpty().withMessage("Email address is required")
  .isEmail().withMessage("Invalid email address")
  .toLowerCase()

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
    body("first_name")
      .notEmpty().withMessage("First name is required"),
    body("last_name")
      .notEmpty().withMessage("Last name is required"),
    body("password")
      .notEmpty().withMessage("Password is required")
      .isStrongPassword().withMessage("Password must be strong"),
  ],
  sendLink: [
    emailValidator,
    body("type")
      .notEmpty().withMessage("Link type is required")
      .default("reset")
      .isIn(["reset", "verify"]).withMessage("Invalid request type")
  ],
  verifyEmail:
    body("token")
      .notEmpty().withMessage("Verification code is required")
      .isUUID().withMessage("Invalid token")
  ,
  setPassword: [
    body("token")
      .notEmpty().withMessage("Verification code is required")
      .isUUID().withMessage("Invalid token"),
    body("password")
      .notEmpty().withMessage("Password is required")
      .isStrongPassword().withMessage("Password must be strong"),
  ],
  refreshToken: [
    body("refresh_token")
      .notEmpty().withMessage("Refresh token is required")
  ],
}