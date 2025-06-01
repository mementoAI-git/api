import { NextFunction, Response } from "express";
import { getPagination, responsHandler, validateRequest } from "../../utils/helpers"
import * as service from "./service";
import { IRequest } from "../../utils/interface";
import { StatusCodes } from "http-status-codes";

export async function prompt(req: IRequest, res: Response, next: NextFunction) {
  try {
    validateRequest(req)
    const response = await service.prompt(req.body, req.auth.id)
    return await service.handleStreaming(req.auth.id, response, res)
  } catch (error) {
    next(error)
  }
}

export async function getUserMessages(req: IRequest, res: Response, next: NextFunction) {
  try {
    const { message, data } = await service.getUserMessages(getPagination(req), req.auth.id)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}

export async function transcribeAudio(req: IRequest, res: Response, next: NextFunction) {
  try {
    const { message, data } = await service.transcribeAudio(req.body)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}