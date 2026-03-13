import { Router, type IRouter } from "express";
import * as ctrl from "./controller";

const router: IRouter = Router();

router.post("/tally", ctrl.handleTally);

export const name = "webhooks";
export default router;
