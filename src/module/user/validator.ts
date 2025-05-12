import { body } from "express-validator";

export default {
  setPassword: [
    body("new_password")
      .notEmpty().withMessage("New Password is required")
      .isStrongPassword().withMessage("Password must be strong"),
    body("old_password")
      .notEmpty().withMessage("Old Password is required")
  ]
}