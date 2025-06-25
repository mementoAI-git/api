import { Router } from "express";
import valid from "./validator"
import gaurd from "../../../middleware/gaurd";
import * as ctrl from "./controller"
import fileUploadMiddleWare from "../../../middleware/file-upload";

const router = Router()

router.post("/", gaurd, fileUploadMiddleWare, valid.createMemory, ctrl.createMemory)
router.get("/", gaurd, ctrl.getMemories)
router.get("/:id", gaurd, ctrl.getMemory)
router.put("/:id", gaurd, valid.updateMemory, ctrl.updateMemory)
router.delete("/:id", gaurd, ctrl.deleteMemory)

export const name = "memories"
export default router