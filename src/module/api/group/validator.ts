import { body, param } from "express-validator";

const nameValidator = body("name")
  .trim()
  .notEmpty()
  .withMessage("Name is required")
  .isLength({ max: 120 })
  .withMessage("Name must be at most 120 characters");

const descriptionValidator = body("description")
  .optional()
  .trim()
  .isLength({ max: 500 })
  .withMessage("Description must be at most 500 characters");

const beneficiaryIdsValidator = body("beneficiaryIds")
  .isArray({ min: 1 })
  .withMessage("beneficiaryIds must be a non-empty array")
  .custom((ids: unknown[]) =>
    ids.every((id) => typeof id === "string" && /^[a-fA-F0-9]{24}$/.test(id as string))
  )
  .withMessage("Each beneficiaryId must be a valid Mongo ID");

const mongoIdValidator = param("id").isMongoId().withMessage("Invalid group id");
const beneficiaryIdParamValidator = param("beneficiaryId")
  .isMongoId()
  .withMessage("Invalid beneficiary id");

export default {
  createGroup: [nameValidator, descriptionValidator],
  updateGroup: [mongoIdValidator, nameValidator.optional(), descriptionValidator],
  addMembers: [
    param("id").isMongoId().withMessage("Invalid group id"),
    beneficiaryIdsValidator,
  ],
  removeMember: [mongoIdValidator, beneficiaryIdParamValidator],
  getGroup: [mongoIdValidator],
  deleteGroup: [mongoIdValidator],
  updateGroupBody: [nameValidator.optional(), descriptionValidator],
};
