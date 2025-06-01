import { body } from "express-validator";

export default {
  createMemory: [
    body("title").notEmpty().withMessage("Title is required"),
    body("level").default(1).isInt().withMessage("Level must be an interger"),
    body("attachments.*").optional().isMongoId().withMessage("Invalid file id"),
    body("tags.*").optional().isString().withMessage("Invalid tag")
  ],
  updateMemory: [
    body("status").optional().isIn(["save"]),
    body("attachments").optional().isArray().withMessage("Files must be an array"),
    body("attachments.*").optional().isMongoId().withMessage("Invalid file id"),
  ]
}