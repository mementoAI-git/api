import { Router } from "express"
import gaurd from "../../middleware/gaurd"
import * as ctrl from "./controller"

const router = Router()

router.get("/profile", gaurd, ctrl.getProfile)
router.post("/change-password", gaurd, ctrl.setPassword)
router.put("/profile", gaurd, ctrl.updateProfile)

export const name = "users"
export default router