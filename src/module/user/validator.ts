import { body } from "express-validator";

export default {
  setPassword: [
    body("password")
      .notEmpty().withMessage("Password is required")
      .isStrongPassword().withMessage("Password must be strong")
  ]
}