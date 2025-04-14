import { NextFunction, Response, Request } from "express"
import { IRequest } from "../../utils/interface"
import * as service from "./service"
import { getFiles, responsHandler } from "../../utils/helpers"
import { StatusCodes } from "http-status-codes"

export async function uploadFile(req: IRequest, res: Response, next: NextFunction) {
  try {
    const files = getFiles(req, true)
    const { message, data } = await service.uploadFile(files, req.auth.id)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}

export async function getFile(req: Request, res: Response, next: NextFunction) {
  try {
    const { data } = await service.getFile(req.params.name)

    res.setHeader("Content-Type", data.type);
    res.setHeader("Content-Disposition", `inline; filename="${data.name}"`);
    res.send(data.buffer);
  } catch (error) {
    next(error)
  }
}

export async function removeFile(req: IRequest, res: Response, next: NextFunction) {
  try {
    const { message, data } = await service.removeFile(req.params.name, req.auth.id)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}