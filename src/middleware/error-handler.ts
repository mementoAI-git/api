import { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import dayjs from 'dayjs';
import { compareStrings, responsHandler } from '../utils/helpers';
import { ServiceError } from '../utils/service-error';
import mail from '../module/mail';
import { NODE_ENV } from '../utils/config';
import logger from '../utils/logger';

const errorHandler = (
  err: any,
  req: Request | any,
  res: Response,
  next: NextFunction
) => {

  // If headers have already been sent, we can't send an error response
  if (res.headersSent) {
    logger.error(err, 'Error occurred after headers were sent');
    return;
  }

  const { method, url } = req;

  const timestamp = dayjs().format('DD/MM/YY HH:mm:ss');
  const request = `[${timestamp}] ${method.toUpperCase()} ${url}`;

  const stackLines = err?.stack?.split('\n');
  const path = stackLines?.[1]?.trim() || err;
  const message = stackLines?.[0]?.trim() || err;

  const error_payload = { request, message, path, stackLines };

  logger.error(error_payload, 'Error occurred')

  if (err instanceof ServiceError) {
    return responsHandler(res, err.statusCode, err?.message, err?.data);
  }

  if (compareStrings(NODE_ENV, 'production')) {
    mail.send({
      subject: 'Memento error',
      text: JSON.stringify(error_payload, null, 2),
    });
  }

  logger.fatal(error_payload, 'Error occurred')
  mail.send({
    subject: 'Memento error',
    text: JSON.stringify(error_payload, null, 2),
  });
  return responsHandler(
    res,
    StatusCodes.INTERNAL_SERVER_ERROR,
    'Internal server error',
  );
};

export default errorHandler;
