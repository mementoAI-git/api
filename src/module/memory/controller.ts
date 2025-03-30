import { NextFunction, Request, Response } from "express";
import { StatusCodes } from "http-status-codes"
import { getPagination, responsHandler, validateRequest } from "../../utils/helpers"
import * as service from "./service"

export async function createMemory(req: Request, res: Response, next: NextFunction) {
  try {
    validateRequest(req)
    const { message, data } = await service.createMemory(req.body, req.auth.id)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}

export async function getMemories(req: Request, res: Response, next: NextFunction) {
  try {
    const { message, data } = await service.getMemories(getPagination(req), req.auth.id)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}

export async function getMemory(req: Request, res: Response, next: NextFunction) {
  try {
    const { message, data } = await service.getMemory(req.params.id)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}