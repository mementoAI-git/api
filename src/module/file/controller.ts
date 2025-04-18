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
    const range = req.headers.range;

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader("Content-Type", data.type);
    res.setHeader("Content-Disposition", `inline; filename="${data.name}"`);
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

    if (range) {
      const byteRange = range.replace(/bytes=/, '').split('-');
      const start = parseInt(byteRange[0], 10);
      const end = byteRange[1] ? parseInt(byteRange[1], 10) : data.buffer.length - 1;
      const chunkSize = end - start + 1;

      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${data.buffer.length}`);
      res.setHeader('Content-Length', chunkSize);

      res.send(data.buffer.subarray(start, end + 1));
    } else {
      res.setHeader('Content-Length', data.buffer.length);
      res.status(200).send(data.buffer);
    }
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