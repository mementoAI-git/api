import {NextFunction, Response, Request} from 'express';
import {IRequest} from '../../../utils/interface';
import * as service from './service';
import * as storage from '../../../services/storage';
import {
  getFiles,
  responsHandler,
  getPagination,
  validateRequest,
} from '../../../utils/helpers';
import {StatusCodes} from 'http-status-codes';
import dayjs from 'dayjs';
import {pipeline} from 'stream/promises';
import logger from '../../../utils/logger';
import {CORS_ALLOWED_ORIGINS} from '../../../utils/config';
import {resolveUploadReservationId} from './upload-idempotency';
import {recordCompatibilityUse} from '../../../services/compatibility-telemetry';

export async function uploadFile(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const files = getFiles(req, true);
    const clientDuration = req.body?.duration
      ? parseFloat(req.body.duration)
      : undefined;
    const {message, data} = await service.uploadFile(
      files,
      req.auth.id,
      clientDuration,
      resolveUploadReservationId(
        req.header('Idempotency-Key'),
        req.context?.requestId,
        'file',
      ),
    );
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
  // Listen for errors on the stream
  stream.on('error', streamError => {
    logger.error({err: streamError}, 'Stream error while piping file response');
    if (!res.headersSent) {
      res.destroy();
    }
  });

  // Abort streaming if the client closes the connection
  const abortController = new AbortController();
  const onClose = () => {
    abortController.abort();
    // Safely destroy the stream if the method exists
    (stream as any).destroy?.();
    logger.info('Response closed by client, aborting stream');
  };
  res.on('close', onClose);

  try {
    await pipeline(stream, res, {
      signal: abortController.signal,
    });
  } catch (error) {
    if (isClientDisconnectError(error) || abortController.signal.aborted) {
      logger.info(
        'Client disconnected or stream aborted during file streaming',
      );
    } else {
      throw error;
    }
  } finally {
    // Clean up listener
    res.off('close', onClose);
  }
};

// Helper function to set common response headers
const setCapabilityCorsHeaders = (req: Request, res: Response): void => {
  const origin = req.header('origin');
  if (origin && CORS_ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
};

const setFileHeaders = (
  req: Request,
  res: Response,
  metadata: any,
  cacheTtl: number,
): void => {
  const commonHeaders = {
    'Content-Type': metadata.type,
    'Content-Disposition': `inline; filename="${metadata.name}"`,
    'Cross-Origin-Resource-Policy': 'cross-origin',
    ETag: metadata.etag,
    'Cache-Control': `private, max-age=${cacheTtl}`,
    'Last-Modified': dayjs(metadata.updated_at).toDate().toUTCString(),
    'Accept-Ranges': 'bytes',
  };

  Object.entries(commonHeaders).forEach(([key, value]) => {
    res.setHeader(key, value);
  });
  setCapabilityCorsHeaders(req, res);

  // Add video-specific headers
  if (metadata.type.startsWith('video/')) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
  }
};

export async function getFile(req: Request, res: Response, next: NextFunction) {
  try {
    const name = String(req.params.name);
    const range = req.headers?.range;
    const resolved = await service.resolveFileRequest(name, req.query);
    if (resolved.expiresAt === null) {
      void recordCompatibilityUse(
        'compat.files.legacy_bare_url',
        (req as IRequest).context,
        {file_id: resolved.file.id},
      );
    }

    const metadata = await service.getResolvedFileMetadata(resolved);
    setFileHeaders(req, res, metadata, resolved.cacheTtl);

    // ── Range request (partial content) ─────────────────────────────────────
    if (range) {
      const data = await service.getResolvedFileBuffer(
        resolved,
        Number(metadata.size),
        range,
      );
      const {start, end, buffer} = data;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${metadata.size}`,
        'Content-Length': end - start + 1,
        'Content-Type': metadata.type,
        'Accept-Ranges': 'bytes',
        'Cache-Control': `private, max-age=${resolved.cacheTtl}`,
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

    // ── Full-file audio/video: pipe storage stream directly → response ───────
    // Buffering the whole file first (the old path) causes the browser to wait
    // for the API server to download the entire file from GCS before it gets
    // a single byte, delaying `canplay` and the Play button by several seconds.
    // Piping the stream directly means the browser starts receiving data
    // almost immediately (only limited by cloud → API → browser network time).
    const isMedia =
      metadata.type?.startsWith('audio/') ||
      metadata.type?.startsWith('video/');

    if (isMedia) {
      res.setHeader('Content-Length', metadata.size);
      res.setHeader('Accept-Ranges', 'bytes');
      res.status(200);

      const fileResponse = await storage.getFile(
        resolved.key,
        undefined,
        resolved.file.provider,
        resolved.type,
      );
      if (!fileResponse.Body) throw new Error('File content not found');
      await safeStreamToResponse(
        fileResponse.Body as NodeJS.ReadableStream,
        res,
      );
      return;
    }

    // ── Non-media files: buffered path (supports Redis cache) ────────────────
    const data = await service.getResolvedFileBuffer(
      resolved,
      Number(metadata.size),
    );
    res.setHeader('Content-Length', metadata.size);
    res.setHeader('Accept-Ranges', 'bytes');
    res.status(200);
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
      logger.error({err: error}, 'Error after headers sent');
    }
  }
}

export async function refreshFileAccess(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    validateRequest(req);
    const {message, data} = await service.refreshFileAccess(
      String(req.params.id),
      req.auth.id,
      req.body || {},
    );
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function removeFile(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const {message, data} = await service.removeFile(
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
    const {message, data} = await service.getFiles(
      getPagination(req),
      req.auth.id,
    );
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}
