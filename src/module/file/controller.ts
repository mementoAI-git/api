import { NextFunction, Response, Request } from "express"
import { IRequest } from "../../utils/interface"
import * as service from "./service"
import { getFiles, responsHandler } from "../../utils/helpers"
import { StatusCodes } from "http-status-codes"
import dayjs from "dayjs"
import { pipeline } from 'stream/promises';

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
    const { name } = req.params;
    const range = req.headers?.range;

    const metadata = await service.getFileMetadata(name);

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', metadata.type);
    res.setHeader('Content-Disposition', `inline; filename="${metadata.name}"`);
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')

    res.setHeader('ETag', metadata.etag);
    res.setHeader('Cache-Control', 'public, max-age=3600'); // 1 hour cache
    res.setHeader('Last-Modified', dayjs(metadata.updated_at).toDate().toUTCString());

    const data = await service.getFileBuffer(name, parseInt(metadata.size, 10), range)
    if (range) {
      const { start, end, buffer } = data;

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${metadata.size}`,
        'Content-Length': end - start + 1,
        'Accept-Ranges': 'bytes'
      });

      const stream = service.createFileStream(buffer);
      await pipeline(stream, res);
    } else {
      res.setHeader('Content-Length', metadata.size);
      res.status(200)

      if (Number(metadata.size) < data.chunk_size) {
        res.send(data.buffer);
      } else {
        const stream = service.createFileStream(data.buffer);
        await pipeline(stream, res);
      }
    }
  } catch (error) {
    next(error);
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