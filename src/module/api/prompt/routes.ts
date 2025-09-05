import { Router } from "express";
import * as ctrl from "./controller"
import valid from "./validator"
import gaurd from "../../../middleware/gaurd";
import fileUploadMiddleWare from "../../../middleware/file-upload";
import { idValidator } from "../../../utils/helpers";

const router = Router()

router.get("/", gaurd, ctrl.getPrompts)
router.post("/reply", gaurd, fileUploadMiddleWare, valid.replyPrompt, ctrl.replyPrompt)
router.get("/reply/:id", gaurd, idValidator, ctrl.getUserPrompt)
router.get("/suggestions", gaurd, ctrl.getSuggestions)

export const name = "prompts"
export default router