import { NextFunction, Response } from "express"
import * as service from "./service"
import { responsHandler, validateRequest } from "../../utils/helpers"
import { StatusCodes } from "http-status-codes"
import { IRequest } from "../../utils/interface"

export async function updateProfile(req: IRequest, res: Response, next: NextFunction) {
  try {
    validateRequest(req)

    const { message, data } = await service.updateProfile(req.body, req.auth.id)

    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}

export async function getProfile(req: IRequest, res: Response, next: NextFunction) {
  try {
    const { message, data } = await service.getProfile(req.auth.id)

    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}

export async function setPassword(req: IRequest, res: Response, next: NextFunction) {
  try {
    const { message, data } = await service.setPassword(req.body, req.auth.id)

    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}

export async function updateStreak(req: IRequest, res: Response, next: NextFunction) {
  try {
    const { message, data } = await service.updateStreak(req.auth.id)

    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}