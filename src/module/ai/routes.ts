import { Router } from "express"
import gaurd from "../../middleware/gaurd"
import * as ctrl from "./controller"
import valid from "./validator"

const router = Router()

router.post("/prompt", valid.prompt, gaurd, ctrl.prompt)
router.get("/prompt/messages", gaurd, ctrl.getUserMessages)
router.post("/transcribe-audio", gaurd, ctrl.transcribeAudio)

export default router