import {NextFunction, Request, Response} from 'express';
import {StatusCodes} from 'http-status-codes';
import dayjs from 'dayjs';
import {responsHandler} from '../utils/helpers';
import {ServiceError} from '../utils/service-error';
import logger from '../utils/logger';

const errorHandler = (
  err: any,
  req: Request | any,
  res: Response,
  next: NextFunction,
) => {
  // If headers have already been sent, we can't send an error response
  if (res.headersSent) {
    logger.error(err, 'Error occurred after headers were sent');
    return;
  }

  const {method, url} = req;

  const timestamp = dayjs().format('DD/MM/YY HH:mm:ss');
  const request = `[${timestamp}] ${method.toUpperCase()} ${url}`;

  const stackLines = err?.stack?.split('\n');
  const path = stackLines?.[1]?.trim() || err;

  // Extract a clean message, falling back to err.code or stack if err.message is generic/empty
  let message = err?.message || stackLines?.[0]?.trim() || String(err);
  if (message === 'Error' && err?.code) {
    message = `${err.code}: File upload error`;
  }

  const error_payload = {request, message, path, stackLines};

  // Intercept and cleanly handle Multer/upload limit errors
  const isMulterError =
    err?.name === 'MulterError' ||
    err?.code?.startsWith('LIMIT_') ||
    err?.code === 'MISSING_FIELD_NAME' ||
    (err && 'storageErrors' in err);

  if (isMulterError) {
    const statusCode =
      err.code === 'LIMIT_FILE_SIZE'
        ? StatusCodes.REQUEST_TOO_LONG // 413 Payload Too Large
        : StatusCodes.BAD_REQUEST; // 400 Bad Request

    const msg =
      err.message && err.message !== 'Error'
        ? err.message
        : err.code === 'LIMIT_FILE_SIZE'
          ? 'File too large'
          : 'File upload limit exceeded';

    logger.warn(error_payload, 'Multer file upload limit exceeded');
    return responsHandler(res, statusCode, msg);
  }

  // Log actual unexpected/internal errors as ERROR
  logger.error(error_payload, 'Error occurred');

  if (err instanceof ServiceError) {
    if (
      err.statusCode === StatusCodes.PAYMENT_REQUIRED &&
      err?.data &&
      typeof err.data === 'object'
    ) {
      const gateData = err.data as Record<string, unknown>;
      return res.status(err.statusCode).json({
        status: err.statusCode,
        message: err.message,
        ...gateData,
        data: gateData,
      });
    }
    return responsHandler(res, err.statusCode, err?.message, err?.data);
  }

  // if (compareStrings(NODE_ENV, 'production')) {
  //   mail.send({
  //     subject: 'Memento error',
  //     text: JSON.stringify(error_payload, null, 2),
  //   });
  // }

  logger.fatal(error_payload, 'Error occurred');
  // mail.send({
  //   subject: 'Memento error',
  //   text: JSON.stringify(error_payload, null, 2),
  // });
  return responsHandler(
    res,
    StatusCodes.INTERNAL_SERVER_ERROR,
    'Internal server error',
  );
};

export default errorHandler;
