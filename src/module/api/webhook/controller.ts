import { NextFunction, Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { responsHandler } from "../../../utils/helpers";
import * as service from "./service";
import type { ITallyWebhookPayload } from "./interface";

export async function handleTally(req: Request, res: Response, next: NextFunction) {
  try {
    const payload = req.body as ITallyWebhookPayload;
    if (!payload) {
      return responsHandler(
        res,
        StatusCodes.BAD_REQUEST,
        "Missing raw body for signature verification",
        null
      );
    }
    const signature = req.headers["tally-signature"] as string | undefined;

    service.verifyTallySignature(req.body, signature);

    const result = await service.processTallySubmission(payload);

    return responsHandler(res, StatusCodes.OK, result.message, result.data);
  } catch (error) {
    next(error);
  }
}
