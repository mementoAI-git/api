import {NextFunction, Request, Response} from 'express';
import {BadRequestException} from '../../../utils/service-error';
import {StatusCodes} from 'http-status-codes';
import {responsHandler} from '../../../utils/helpers';
import * as service from './service';
import type {ITallyWebhookPayload} from './interface';
import * as billingService from '../billing/service';
import {
  processAppleStoreNotification,
  processGooglePlayNotification,
  verifyGooglePubSubRequest,
} from '../billing/store-notification-service';

export async function handleTally(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const requestWithRawBody = req as Request & {rawBody?: Buffer};
    const rawBody = Buffer.isBuffer(requestWithRawBody.rawBody)
      ? requestWithRawBody.rawBody
      : null;
    const payload = req.body as ITallyWebhookPayload;
    if (!payload || !rawBody) {
      return responsHandler(
        res,
        StatusCodes.BAD_REQUEST,
        'Missing raw body for signature verification',
        null,
      );
    }
    const signature = req.headers['tally-signature'] as string | undefined;

    service.verifyTallySignature(rawBody, signature);

    const result = await service.processTallySubmission(payload);

    return responsHandler(res, StatusCodes.OK, result.message, result.data);
  } catch (error) {
    return next(error);
  }
}

export async function handlePayments(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const provider = String(req.query.provider || '').toLowerCase();
    if (provider !== 'polar') {
      return responsHandler(
        res,
        StatusCodes.BAD_REQUEST,
        'Unsupported provider',
        {provider},
      );
    }

    const capturedBody = (req as Request & {rawBody?: Buffer}).rawBody;
    const rawBody = Buffer.isBuffer(capturedBody) ? capturedBody : req.body;
    if (!Buffer.isBuffer(rawBody))
      throw new BadRequestException('Raw webhook body is required');
    const headers = {
      id: req.get('webhook-id'),
      timestamp: req.get('webhook-timestamp'),
      signature: req.get('webhook-signature'),
    };
    service.verifyPolarSignature(rawBody, headers);

    const payload = JSON.parse(rawBody.toString('utf8')) as Record<
      string,
      unknown
    >;
    const result = await billingService.processPolarWebhook(
      payload,
      headers.id,
    );
    return responsHandler(res, StatusCodes.OK, result.message, result.data);
  } catch (error) {
    return next(error);
  }
}

export async function handleAppleStore(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const result = await processAppleStoreNotification(
      typeof req.body?.signedPayload === 'string' ? req.body.signedPayload : '',
    );
    return res.status(StatusCodes.NO_CONTENT).send(result);
  } catch (error) {
    return next(error);
  }
}

export async function handleGooglePlay(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    await verifyGooglePubSubRequest(req.headers.authorization);
    const result = await processGooglePlayNotification(req.body);
    return res.status(StatusCodes.NO_CONTENT).send(result);
  } catch (error) {
    return next(error);
  }
}
