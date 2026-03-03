import { Router, type IRouter } from "express";
import * as ctrl from "./controller";
import gaurd from "../../../middleware/gaurd";
import * as dto from "./dto"
import validate from "../../../middleware/validator";

const router: IRouter = Router();

router.post("/", gaurd, validate(dto.createGroupSchema), ctrl.create);
router.get("/", gaurd, ctrl.list);
router.get("/:id", gaurd, validate(dto.getGroupSchema), ctrl.getOne);
router.put("/:id", gaurd, validate(dto.updateGroupSchema), ctrl.update);
router.delete("/:id", gaurd, validate(dto.deleteGroupSchema), ctrl.del);
router.post("/:id/members", gaurd, validate(dto.addMembersSchema), ctrl.addMembers);
router.delete(
  "/:id/members/:beneficiaryId",
  gaurd,
  validate(dto.removeMemberSchema),
  ctrl.removeMember
);

export const name = "groups";
export default router;
