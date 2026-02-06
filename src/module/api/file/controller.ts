import { NextFunction, Response, Request } from "express"
import { IRequest } from "../../../utils/interface"
import * as service from "./service"
import { getFiles, responsHandler, getPagination, validateRequest } from "../../../utils/helpers"
import { StatusCodes } from "http-status-codes"
import dayjs from "dayjs"
import { pipeline } from 'stream/promises';
import logger from "../../../utils/logger"

export async function uploadFile(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const files = getFiles(req, true);
    const { message, data } = await service.uploadFile(files, req.auth.id);
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

// Helper function to check if error is a client disconnect
const isClientDisconnectError = (error: any): boolean => {
  const disconnectCodes = ['ERR_STREAM_PREMATURE_CLOSE', 'ECONNRESET', 'EPIPE'];
  return disconnectCodes.includes(error?.code);
};

// Helper function to safely stream data to response
const safeStreamToResponse = async (
  stream: NodeJS.ReadableStream,
  res: Response,
): Promise<void> => {
  stream.on('error', streamError => {
    console.error('Stream error:', streamError);
    if (!res.headersSent) {
      res.destroy();
    }
  });

  try {
    await pipeline(stream, res);
  } catch (error) {
    if (isClientDisconnectError(error)) {
      logger.info('Client disconnected during file streaming');
    } else {
      throw error;
    }
  }
};

// Helper function to set common response headers
const setFileHeaders = (res: Response, metadata: any): void => {
  const commonHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': metadata.type,
    'Content-Disposition': `inline; filename="${metadata.name}"`,
    'Cross-Origin-Resource-Policy': 'cross-origin',
    ETag: metadata.etag,
    'Cache-Control': 'public, max-age=3600',
    'Last-Modified': dayjs(metadata.updated_at).toDate().toUTCString(),
    'Accept-Ranges': 'bytes',
  };

  Object.entries(commonHeaders).forEach(([key, value]) => {
    res.setHeader(key, value);
  });

  // Add video-specific headers
  if (metadata.type.startsWith('video/')) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
  }
};

export async function getFile(req: Request, res: Response, next: NextFunction) {
  try {
    const name = String(req.params.name);
    const range = req.headers?.range;

    const metadata = await service.getFileMetadata(name);
    setFileHeaders(res, metadata);

    const data = await service.getFileBuffer(
      name,
      parseInt(metadata.size, 10),
      range,
    );

    // Handle range requests (partial content)
    if (range) {
      const { start, end, buffer } = data;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${metadata.size}`,
        'Content-Length': end - start + 1,
        'Content-Type': metadata.type,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=3600',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers':
          'Content-Range, Content-Length, Accept-Ranges',
        'Cross-Origin-Resource-Policy': 'cross-origin',
        ETag: metadata.etag,
        'Last-Modified': dayjs(metadata.updated_at).toDate().toUTCString(),
        'Content-Disposition': `inline; filename="${metadata.name}"`,
      });

      const stream = service.createFileStream(buffer);
      await safeStreamToResponse(stream, res);
      return;
    }

    // Handle full file requests
    res.setHeader('Content-Length', metadata.size);
    res.setHeader('Accept-Ranges', 'bytes');
    res.status(200);

    // Send small files directly, stream larger files
    if (Number(metadata.size) < data.chunk_size) {
      res.send(data.buffer);
    } else {
      const stream = service.createFileStream(data.buffer);
      await safeStreamToResponse(stream, res);
    }
  } catch (error) {
    // Only pass to error handler if headers haven't been sent
    if (!res.headersSent) {
      next(error);
    } else {
      console.error('Error after headers sent:', error);
    }
  }
}

export async function removeFile(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const { message, data } = await service.removeFile(
      String(req.params.name),
      req.auth.id,
    );
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function getUserFiles(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    validateRequest(req);
    const { message, data } = await service.getFiles(
      getPagination(req),
      req.auth.id,
    );
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}
