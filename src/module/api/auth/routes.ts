import { Router } from "express";
import * as ctrl from "./controller";
import valid from "./validator"
import rateLimiter from "../../../middleware/rate-limiter";

const router = Router()

router.get("/oauth/:provider", valid.generateOauthUrl, ctrl.generateOauthUrl)
router.post("/oauth/:provider", valid.authorization, ctrl.authorization)
router.post("/login", rateLimiter(5, 5), valid.login, ctrl.login)
router.post("/register", valid.login, ctrl.register)
router.post("/send-link", valid.sendLink, ctrl.sendLink)
router.post("/verify-email", valid.verifyEmail, ctrl.verifyEmail)
router.post("/set-password", valid.setPassword, ctrl.setPassword)

export default router