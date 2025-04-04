import { NextFunction, Response, Request } from "express"
import { IRequest } from "../../utils/interface"
import * as service from "./service"
import { isEmpty, responsHandler } from "../../utils/helpers"
import { StatusCodes } from "http-status-codes"
import { UnprocessableContent } from "../../utils/service-error"
import { UploadedFile } from "express-fileupload"

export async function uploadFile(req: IRequest, res: Response, next: NextFunction) {
  try {

    let files: UploadedFile[] = [];

    if (isEmpty(req.files)) {
      throw new UnprocessableContent("Upload a file")
    }
    else if (!Array.isArray(req.files.file)) files.push(req.files.file);
    else files = req.files.file;

    const allowedTypes = new Set(["image/png", "image/jpeg", "application/pdf"])
    if (files.some(f => !allowedTypes.has(f.mimetype))) {
      throw new UnprocessableContent("Invalid file type. Only PNG, JPEG, and PDF allowed.")
    }

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