import { Router } from "express";
import gaurd from "../../middleware/gaurd";
import * as ctrl from "./controller"
import fileUploadMiddleWare from "../../middleware/file-upload";

const router = Router()

router.post("/upload", fileUploadMiddleWare, gaurd, ctrl.uploadFile)

export const name = "files"
export default router