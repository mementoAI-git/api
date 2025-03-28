import { NextFunction, Response, Request } from "express"
import * as service from "./service"
import { responsHandler, validateRequest } from "../../utils/helpers"
import { StatusCodes } from "http-status-codes"

export async function updateProfile(req: Request, res: Response, next: NextFunction) {
  try {
    validateRequest(req)

    const { message, data } = await service.updateProfile(req.body, req.auth.id)

    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}

export async function getProfile(req: Request, res: Response, next: NextFunction) {
  try {
    const { message, data } = await service.getProfile(req.auth.id)

    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}

export async function setPassword(req: Request, res: Response, next: NextFunction) {
  try {
    const { message, data } = await service.setPassword(req.body, req.auth.id)

    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}