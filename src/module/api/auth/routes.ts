import { Router, type IRouter } from "express";
import * as ctrl from "./controller";
import valid from "./validator"
import rateLimiter from "../../../middleware/rate-limiter";
import guard from "../../../middleware/gaurd";

const router: IRouter = Router()

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

// 2FA login verification (completes a login that was paused for 2FA)
router.post("/2fa/verify", rateLimiter(10, 5), valid.verify2FALogin, ctrl.verify2FALogin)

// Passkey registration (requires authenticated session)
router.post("/passkey/register/begin", guard, ctrl.beginPasskeyRegistration)
router.post("/passkey/register/complete", guard, valid.completePasskeyRegistration, ctrl.completePasskeyRegistration)

// Passkey login (public — no session)
router.post("/passkey/login/begin", ctrl.beginPasskeyLogin)
router.post("/passkey/login/complete", valid.completePasskeyLogin, ctrl.completePasskeyLogin)

export default router