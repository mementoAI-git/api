import { NextFunction, Response } from "express";
import { StatusCodes } from "http-status-codes"
import { responsHandler, validateRequest } from "../../utils/helpers"
import * as service from "./service";
import { IRequest } from "../../utils/interface";
import { ServiceError } from "../../utils/service-error";

export async function prompt(req: IRequest, res: Response, next: NextFunction) {
  try {
    validateRequest(req)
    const response = await service.prompt(req.body, req.auth.id)

    for await (const chunk of response) {
      if (chunk.text) {
        res.write(chunk.text);
      }
    }
    res.end();
  } catch (error) {
    if (error instanceof ServiceError) {
      next(error)
    } else {
      res.write(`event: error\ndata: ${JSON.stringify(error)}\n\n`);
      res.end();
    }
  }
}