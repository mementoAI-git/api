import { Router } from "express"
import gaurd from "../../../middleware/gaurd"
import * as ctrl from "./controller"
import valid from "./validator"
import { idValidator } from "../../../utils/helpers"

const router = Router()

router.post("/prompt",
  valid.prompt,
  gaurd,
  ctrl.prompt
)

//Depericated
router.get("/prompt/messages", gaurd, ctrl.getUserMessages)

router.get(
  "/prompt/messages/:id",
  gaurd,
  idValidator,
  ctrl.getUserMessagesByConversation
)

router.post("/conversation/new", gaurd, valid.startConversation, ctrl.startConversation)
router.post("/transcribe-audio", gaurd, ctrl.transcribeAudio)
router.get("/ephemeral-token", gaurd, ctrl.getEphemeralToken)

export default router