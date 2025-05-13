import { NextFunction, Response } from "express"
import * as service from "./service"
import { getFiles, responsHandler, validateRequest } from "../../utils/helpers"
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
export async function uploadPicture(req: IRequest, res: Response, next: NextFunction) {
  try {
    const files = getFiles(req, true)
    const { message, data } = await service.uploadPicture(files, req.auth.id)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}

export async function verifyTOTP(req: IRequest, res: Response, next: NextFunction) {
  try {
    validateRequest(req)
    const { message, data } = await service.verifyTOTP(req.body, req.auth.id)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}

export async function setup2FA(req: IRequest, res: Response, next: NextFunction) {
  try {
    const { message, data } = await service.setup2FA(req.auth.id)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}

export async function disable2FA(req: IRequest, res: Response, next: NextFunction) {
  try {
    const { message, data } = await service.disable2FA(req.auth.id)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}