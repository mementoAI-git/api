import { body } from "express-validator";

export default {
  setPassword: [
    body("new_password")
      .notEmpty().withMessage("New Password is required")
      .isStrongPassword().withMessage("Password must be strong"),
    body("old_password")
      .notEmpty().withMessage("Old Password is required")
  ],
  verifyTOTP: body("token").notEmpty().withMessage("Token is required"),
  updateContext: [
    body("important_notes").optional().isArray(),
    body("key_preferences").optional().isArray(),
    body("conversation_history_summary").optional().isString(),
    body("emotional_state_trends").optional().isArray(),
    body("goals_and_aspirations").optional().isArray(),
    body("self_description").optional().isString().isLength({ max: 500 }),
    body("current_priority").optional().isString().isLength({ max: 200 }),
    body("join_reasons").optional().isArray()
  ],
  completeOnboarding: [
    body("self_description").optional().isString().isLength({ max: 500 }),
    body("current_priority").optional().isString().isLength({ max: 200 }),
    body("dob").optional().isISO8601().toDate(),
    body("join_reasons").optional().isArray()
  ]
}