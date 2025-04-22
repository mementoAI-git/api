import { Router } from "express";
import valid from "./validator"
import gaurd from "../../middleware/gaurd";
import * as ctrl from "./controller"

const router = Router()

router.post("/", gaurd, valid.createMemory, ctrl.createMemory)
router.get("/", gaurd, ctrl.getMemories)
router.get("/:id", gaurd, ctrl.getMemory)
router.put("/:id", gaurd, valid.updateMemory, ctrl.updateMemory)

export const name = "memories"
export default router