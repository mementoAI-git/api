import { Router } from "express"
import gaurd from "../../../middleware/gaurd"
import * as ctrl from "./controller"
import valid from "./validator"
import fileUploadMiddleWare from "../../../middleware/file-upload"

const router = Router()

router.get("/profile", gaurd, ctrl.getProfile)
router.post("/change-password", valid.setPassword, gaurd, ctrl.setPassword)
router.put("/profile", gaurd, ctrl.updateProfile)
router.put("/context", valid.updateContext, gaurd, ctrl.updateContext)
router.post("/update-streak", gaurd, ctrl.updateStreak)
router.post("/upload-picture", fileUploadMiddleWare, gaurd, ctrl.uploadPicture)
router.get("/2fa/setup", gaurd, ctrl.setup2FA)
router.post("/2fa/verify", valid.verifyTOTP, gaurd, ctrl.verifyTOTP)
router.delete("/2fa/disable", gaurd, ctrl.disable2FA)
router.post("/complete-onboarding", valid.completeOnboarding, gaurd, ctrl.completeOnboarding)
router.delete("/account", gaurd, ctrl.deleteUser)
router.get("/stats", gaurd, ctrl.getUserStats)

export const name = "users"
export default router