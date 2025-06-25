import { body } from "express-validator";
import { emailValidator } from "../auth/validator";

export default {
  createBeneficiary: [
    emailValidator,
    body("level").optional().isInt().withMessage("Level must be an integer"),
    // body("relationship").notEmpty().withMessage("Relationship is required"),
    // body("name").notEmpty().withMessage("Name is required")
  ],
  updateBeneficiary: [
    body("email").optional().isEmail().withMessage("Invalid email address"),
    body("level").optional().isInt().withMessage("Level must be an integer")
  ],
  resendInvite: emailValidator
}