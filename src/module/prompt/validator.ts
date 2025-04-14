import { body } from "express-validator";

export default {
  replyPrompt: [
    body("prompt_id")
      .notEmpty().withMessage("Prompt id is required")
      .isMongoId().withMessage("Invalid promp id")
  ]
}