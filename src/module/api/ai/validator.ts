import { body } from "express-validator";

export default {
  prompt: [
    body("text").notEmpty().withMessage("Text is reqired"),
    body("memory")
      .notEmpty().withMessage("memory is reqired")
      .isMongoId().withMessage("Invalid memory id")
    ,
    body("attachments")
      .optional()
      .isArray().withMessage("Files must be an array"),
    body("attachments.*")
      .optional()
      .isMongoId().withMessage("Invalid file id")
  ],
  startMemory: [
    body("text").notEmpty().withMessage("Text is reqired"),
    body("prompt_id")
      .optional()
      .isMongoId().withMessage("Invalid prompt id"),
    body("attachments")
      .optional()
      .isArray().withMessage("Files must be an array"),
    body("attachments.*")
      .optional()
      .isMongoId().withMessage("Invalid file id")
  ]
}