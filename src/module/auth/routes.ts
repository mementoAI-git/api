import { Router } from "express";
import * as ctrl from "./controller";
import valid from "./validator"

const router = Router()

router.get("/oauth/:provider", valid.generateOauthUrl, ctrl.generateOauthUrl)
router.post("/oauth/:provider", valid.authorization, ctrl.authorization)
router.post("/login", valid.login, ctrl.login)
router.post("/register", valid.login, ctrl.register)
router.post("/send-code", valid.sendAuthCode, ctrl.sendAuthCode)
router.post("/verify-code", valid.verifyCode, ctrl.verifyCode)

export default router