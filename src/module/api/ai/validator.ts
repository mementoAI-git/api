import { body } from "express-validator";

export default {
  prompt: [
    body("text").notEmpty().withMessage("Text is reqired"),
    body("attachments")
      .optional()
      .isArray().withMessage("Files must be an array"),
    body("attachments.*")
      .optional()
      .isMongoId().withMessage("Invalid file id")
  ]
}