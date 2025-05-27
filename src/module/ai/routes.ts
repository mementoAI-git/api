import { Router } from "express"
import gaurd from "../../middleware/gaurd"
import * as ctrl from "./controller"

const router = Router()

router.post("/prompt", gaurd, ctrl.prompt)

export default router