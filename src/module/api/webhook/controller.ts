import {NextFunction, Request, Response} from 'express';
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

    const rawBody = Buffer.isBuffer((req as Request | any).rawBody)
      ? (req as Request | any).rawBody
      : Buffer.isBuffer(req.body)
        ? req.body
        : Buffer.from(JSON.stringify(req.body || {}));
    const signature = req.headers['polar-signature'] as string | undefined;
    service.verifyPolarSignature(
      rawBody,
      req.headers['webhook-signature'] ? req.headers : signature,
    );

    const payload = JSON.parse(rawBody.toString('utf8')) as Record<
      string,
      unknown
    >;
    const deliveryId =
      typeof req.headers['webhook-id'] === 'string'
        ? req.headers['webhook-id']
        : undefined;
    const result = await billingService.processPolarWebhook(
      payload,
      deliveryId,
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
