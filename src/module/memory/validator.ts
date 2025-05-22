import { body } from "express-validator";

export default {
  createMemory: [
    body("title").notEmpty().withMessage("Title is required"),
    // body("body").notEmpty().withMessage("Body is required"),
    body("level")
      .default(1)
      .isInt().withMessage("Level must be an interger"),
    body("attachments").optional().isArray(),
    body("attachments.*").isMongoId().withMessage("Invalid file id"),
    body("tags").optional().isArray(),
    body("tags.*").isString().withMessage("Invalid tag")
  ],
  updateMemory: [
    body("status").optional().isIn(["save"]),
    body("attachments").optional().isArray(),
    body("attachments.*").optional().isMongoId().withMessage("Invalid file id"),
  ]
}