import { Router } from "express";
import * as ctrl from "./controller"
import valid from "./validator"
import gaurd from "../../../middleware/gaurd";
import fileUploadMiddleWare from "../../../middleware/file-upload";

const router = Router()

router.get("/", gaurd, ctrl.getPrompts)
router.post("/reply", gaurd, fileUploadMiddleWare, valid.replyPrompt, ctrl.replyPrompt)
router.get("/reply/:id", gaurd, ctrl.getUserPrompt)

export const name = "prompts"
export default router