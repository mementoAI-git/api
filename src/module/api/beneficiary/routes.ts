import { Router, type IRouter } from "express";
import valid from "./validator";
import * as ctrl from "./controller";
import * as dto from "./dto";
import gaurd from "../../../middleware/gaurd";
import validate from "../../../middleware/validator";

const router: IRouter = Router();

router.post("/", gaurd, validate(dto.createBeneficiarySchema), ctrl.create);
router.get("/", gaurd, ctrl.list)
router.put("/:id", gaurd, valid.updateBeneficiary, ctrl.update)
router.delete("/:id", gaurd, ctrl.del)
router.post("/invite/resend", gaurd, valid.resendInvite, ctrl.resendInvite)
router.post("/invite/accept", valid.acceptInvite, ctrl.acceptInvite)
router.get("/invite/:id", valid.getInvite, ctrl.getInvite)

export const name = "beneficiaries"
export default router