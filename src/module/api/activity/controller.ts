import { Response, NextFunction } from "express"
import { StatusCodes } from "http-status-codes"
import { getPagination, responsHandler } from "../../../utils/helpers"
import { IRequest } from "../../../utils/interface"
import * as service from "./service"

export async function getUserActivities(req: IRequest, res: Response, next: NextFunction) {
  try {
    const { message, data } = await service.getUserActivities(getPagination(req), req.auth.id)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}

export async function clearUserActivities(req: IRequest, res: Response, next: NextFunction) {
  try {
    const { message, data } = await service.clearUserActivities(req.auth.id)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
} 