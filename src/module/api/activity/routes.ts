import { Router, type IRouter } from "express"
import gaurd from "../../../middleware/gaurd"
import * as ctrl from "./controller"

const router: IRouter = Router()

router.get("/", gaurd, ctrl.getUserActivities)
router.delete("/", gaurd, ctrl.clearUserActivities)

export const name = "activities"
export default router 