import { Router, type IRouter } from "express";
import valid from "./validator";
import * as ctrl from "./controller";
import gaurd from "../../../middleware/gaurd";

const router: IRouter = Router();

router.post("/", gaurd, valid.createGroup, ctrl.create);
router.get("/", gaurd, ctrl.list);
router.get("/:id", gaurd, valid.getGroup, ctrl.getOne);
router.put("/:id", gaurd, valid.updateGroup, ctrl.update);
router.delete("/:id", gaurd, valid.deleteGroup, ctrl.del);
router.post("/:id/members", gaurd, valid.addMembers, ctrl.addMembers);
router.delete(
  "/:id/members/:beneficiaryId",
  gaurd,
  valid.removeMember,
  ctrl.removeMember
);

export const name = "groups";
export default router;
