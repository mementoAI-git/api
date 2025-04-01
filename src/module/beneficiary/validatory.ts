import { body } from "express-validator";
import { emailValidator } from "../auth/validator";

export default {
  createBeneficiary: [
    emailValidator,
    body("level").optional().isInt().withMessage("Level must be an integer")
  ],
  updateBeneficiary: [
    body("email").optional().isEmail().withMessage("Invalid email address"),
    body("level").optional().isInt().withMessage("Level must be an integer")
  ],
}