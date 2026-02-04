import { body, query } from "express-validator";

export default {
  createCapsule: [
    body("recipients").isArray().withMessage("Invalid recipients"),
    body("recipients.*").isEmail().withMessage("Invalid email address"),
    body("title").notEmpty().withMessage("Title is required"),
    body("body").notEmpty().withMessage("Body is required"),
    body("schedule_date")
      .optional()
      .isISO8601().withMessage("Invalid schedule date, it must be in ISO 8601 format"),
    body("attachments")
      .optional()
      .isArray().withMessage("Attachments must be an array"),
    body("attachments.*")
      .optional()
      .isMongoId().withMessage("Each attachment must be a valid ID"),
    body("memories")
      .optional()
      .isArray().withMessage("Memories must be an array"),
    body("memories.*")
      .optional()
      .isMongoId().withMessage("Each memory must be a valid Mongo ID")
  ],
  updateCapsule: [
    body("recipients")
      .optional()
      .isArray().withMessage("Recipients must be an array"),
    body("recipients.*")
      .optional()
      .isEmail().withMessage("Each recipient must be a valid email"),
    body("schedule_date")
      .optional()
      .isISO8601().withMessage("Schedule date must be in ISO 8601 format"),
    body("attachments")
      .optional()
      .isArray().withMessage("Attachments must be an array of strings"),
    body("memories")
      .optional()
      .isArray().withMessage("Memories must be an array"),
    body("memories.*")
      .optional()
      .isMongoId().withMessage("Each memory must be a valid Mongo ID"),
    body("status")
      .optional()
      .isIn(["scheduled", "draft", "pause"])
      .withMessage("Invalid status")
  ],
  getCapsules: [
    query("status")
      .optional()
      .isIn(["scheduled", "draft", "delivered", "failed", "pause"])
      .withMessage("Invalid status. Must be one of: scheduled, draft, delivered, failed, pause")
  ]
}