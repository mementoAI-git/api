import { body } from "express-validator";

export default {
  createCapsule: [
    body("recipients"),
    body("title").notEmpty().withMessage("Title is required"),
    body("body").notEmpty().withMessage("Body is required"),
    body("delivery_date")
      .notEmpty().withMessage("Delivery date is required")
      .isDate({ strictMode: true }).withMessage("Invalid devlivery date")
  ]
}