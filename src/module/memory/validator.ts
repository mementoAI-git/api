import { body } from "express-validator";

export default {
  createMemory: [
    body("title").notEmpty().withMessage("Title is required"),
    body("body").notEmpty().withMessage("Body is required"),
    body("level")
      .notEmpty().withMessage("Permission level is required")
      .isInt().withMessage("Must be an interger"),
    body("attachments").isArray(),
    body("attachments.*").isMongoId().withMessage("Invalid file id"),
    body("tags").isArray(),
    body("tags.*").notEmpty().isString().withMessage("Invalid tag")
  ]
}