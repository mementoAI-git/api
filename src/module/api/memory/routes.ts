import { Router } from "express";
import valid from "./validator"
import gaurd from "../../../middleware/gaurd";
import * as ctrl from "./controller"
import fileUploadMiddleWare from "../../../middleware/file-upload";

const router = Router()

router.get("/stats", gaurd, ctrl.memoryStats)
router.post("/", gaurd, fileUploadMiddleWare, valid.createMemory, ctrl.createMemory)
router.delete("/remove-file/:id", gaurd, valid.removeFileFromMemory, ctrl.removeFileFromMemory)
router.get("/", gaurd, ctrl.getMemories)
router.get("/:id", gaurd, ctrl.getMemory)
router.put("/:id", gaurd, valid.updateMemory, ctrl.updateMemory)
router.delete("/:id", gaurd, ctrl.deleteMemory)
router.post("/:id/bookmark", gaurd, ctrl.bookmark)
router.delete("/:id/bookmark", gaurd, ctrl.unbookmark)

export const name = "memories"
export default router 