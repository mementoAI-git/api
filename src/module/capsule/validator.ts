import dayjs from "dayjs";
import { body } from "express-validator";

export default {
  createCapsule: [
    body("recipients").isArray().withMessage("Invalid recipients"),
    body("recipients.*").isEmail().withMessage("Invalid email address"),
    body("title").notEmpty().withMessage("Title is required"),
    body("body").notEmpty().withMessage("Body is required"),
    body("delivery_date")
      .notEmpty().withMessage("Delivery date is required")
      .isISO8601().withMessage("Invalid delivery date, it must be in ISO 8601 format")
  ],
  updateCapsule: [
    body("recipients")
      .optional()
      .isArray().withMessage("Recipients must be an array"),
    body("recipients.*")
      .optional()
      .isEmail().withMessage("Each recipient must be a valid email"),
    body("delivery_date")
      .optional()
      .isISO8601().withMessage("Delivery date must be in ISO 8601 format"),
    body("attachments")
      .optional()
      .isArray().withMessage("Attachments must be an array of strings"),
    body("status")
      .optional()
      .isIn(["scheduled", "draft", "pause"])
      .withMessage("Invalid status")
  ]
}