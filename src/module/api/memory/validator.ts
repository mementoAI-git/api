import { body, param } from "express-validator";

export default {
  createMemory: [
    body("title")
      .notEmpty().withMessage("Title is required")
      .optional()
      .bail()
      .isString().withMessage("Title must be a string"),
    body("level")
      .optional()
      .isInt({ min: 1 }).withMessage("Level must be a positive integer")
      .toInt(),
    body("attachments")
      .optional({ nullable: true })
      .customSanitizer(value => {
        if (typeof value === "string") return value.split(",");
        return value;
      })
      .isArray().withMessage("Attachments must be an array"),
    body("attachments.*")
      .optional()
      .isMongoId().withMessage("Each attachment must be a valid Mongo ID"),
    body("tags")
      .optional({ nullable: true })
      .customSanitizer(value => {
        if (typeof value === "string") return value.split(",");
        return value;
      })
      .isArray().withMessage("Tags must be an array"),
    body("tags.*")
      .optional()
      .isString().withMessage("Each tag must be a string"),
  ],
  updateMemory: [
    body("status")
      .optional()
      .isIn(["save"]).withMessage("Status must be 'save'"),
    body("attachments")
      .optional({ nullable: true })
      .customSanitizer(value => {
        if (typeof value === "string") return value.split(",");
        return value;
      })
      .isArray().withMessage("Attachments must be an array"),
    body("attachments.*")
      .optional()
      .isMongoId().withMessage("Each attachment must be a valid Mongo ID"),
    body("tags")
      .optional({ nullable: true })
      .customSanitizer(value => {
        if (typeof value === "string") return value.split(",");
        return value;
      })
      .isArray().withMessage("Tags must be an array"),
    body("tags.*")
      .optional()
      .isString().withMessage("Each tag must be a string"),
    body("level")
      .optional()
      .isInt({ min: 1 }).withMessage("Level must be a positive integer")
      .toInt(),
    body("title")
      .optional()
      .isString().withMessage("Title must be a string"),
    body("body")
      .optional()
      .isString().withMessage("Body must be a string"),
  ],
  removeFileFromMemory: [
    param("id")
      .notEmpty().withMessage("file id is required")
      .isMongoId().withMessage("invalid file id")
  ],
}