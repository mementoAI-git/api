import { Router } from "express"
import gaurd from "../../../middleware/gaurd"
import * as ctrl from "./controller"
import valid from "./validator"
import rateLimiter from "../../../middleware/rate-limiter"

const router = Router()

router.post("/prompt",
  rateLimiter(1, 15), // 15 request per min
  rateLimiter(24 * 60, 1500), // 1500 request per min
  valid.prompt,
  gaurd,
  ctrl.prompt
)
router.post("/prompt/greet", gaurd, ctrl.greet)
router.get("/prompt/messages", gaurd, ctrl.getUserMessages)
router.post("/transcribe-audio", gaurd, ctrl.transcribeAudio)

export default router