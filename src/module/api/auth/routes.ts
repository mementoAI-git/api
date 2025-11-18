import { Router } from "express";
import * as ctrl from "./controller";
import valid from "./validator"
import rateLimiter from "../../../middleware/rate-limiter";
import guard from "../../../middleware/gaurd";

const router = Router()

router.get("/oauth/:provider", valid.generateOauthUrl, ctrl.generateOauthUrl)
router.post("/oauth/:provider", valid.authorization, ctrl.authorization)
router.post("/login", rateLimiter(5, 5), valid.login, ctrl.login)
router.post("/register", valid.login, ctrl.register)
router.post("/send-link", valid.sendLink, ctrl.sendLink)
router.post("/verify-email", valid.verifyEmail, ctrl.verifyEmail)
router.post("/set-password", valid.setPassword, ctrl.setPassword)
router.post("/refresh-token", valid.refreshToken, ctrl.refreshToken)
router.delete("/logout", guard, ctrl.logout)
router.post("/send-invite-code", valid.sendInviteCode, ctrl.sendInviteCode)

export default router