import { body, param } from "express-validator";
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
  acceptInvite: [
    body("invite_id")
      .notEmpty().withMessage("Invitation id is required")
      .isMongoId().withMessage("Invalid invite id")
  ],
  getInvite: param("id").isMongoId().withMessage("Invalid invitation link"),
  resendInvite: emailValidator
}