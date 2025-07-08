import { Router } from "express";
import valid from "./validator"
import * as ctrl from "./controller"
import gaurd from "../../../middleware/gaurd";

const router = Router()

router.post("/", gaurd, valid.createBeneficiary, ctrl.create)
router.get("/", gaurd, ctrl.list)
router.put("/:id", gaurd, valid.updateBeneficiary, ctrl.update)
router.delete("/:id", gaurd, ctrl.del)
router.post("/invite/resend", gaurd, valid.resendInvite, ctrl.resendInvite)
router.post("/invite/accept", valid.acceptInvite, ctrl.acceptInvite)
router.get("/invite/:id", valid.getInvite, ctrl.getInvite)

export const name = "beneficiaries"
export default router