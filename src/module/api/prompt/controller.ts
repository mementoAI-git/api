import { NextFunction, Request, Response } from "express";
import { StatusCodes } from "http-status-codes"
import { getFiles, responsHandler, validateRequest } from "../../../utils/helpers"
import * as service from "./service"
import { IRequest } from "../../../utils/interface";

export async function getPrompts(req: Request, res: Response, next: NextFunction) {
  try {
    const { message, data } = await service.getPrompts()
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}

export async function getUserPrompt(req: IRequest, res: Response, next: NextFunction) {
  try {
    const { message, data } = await service.getUserPromptResponse(req.params.id, req.auth.id)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}

export async function replyPrompt(req: IRequest, res: Response, next: NextFunction) {
  try {
    validateRequest(req)
    const files = getFiles(req)
    const { message, data } = await service.replyPrompt(req.body, req.auth.id, files)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}