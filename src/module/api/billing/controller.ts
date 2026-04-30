import {NextFunction, Response} from 'express';
import {StatusCodes} from 'http-status-codes';
import {IRequest} from '../../../utils/interface';
import {responsHandler} from '../../../utils/helpers';
import * as service from './service';

export async function getSubscription(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    await service.ensureBillingUser(req.auth.id);
    const {message, data} = await service.getSubscriptionSummary(req.auth.id);
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function getUsage(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    await service.ensureBillingUser(req.auth.id);
    const {message, data} = await service.getUsage(req.auth.id);
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function checkout(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    await service.ensureBillingUser(req.auth.id);
    const {message, data} = await service.createCheckoutSession(
      req.auth.id,
      req.body,
    );
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function portal(req: IRequest, res: Response, next: NextFunction) {
  try {
    await service.ensureBillingUser(req.auth.id);
    const {message, data} = await service.createPortalSession(
      req.auth.id,
      req.body.return_url,
    );
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function promoRedeem(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    await service.ensureBillingUser(req.auth.id);
    const {message, data} = await service.redeemPromoCode(
      req.auth.id,
      req.body.code,
    );
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function invoices(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    await service.ensureBillingUser(req.auth.id);
    const {message, data} = await service.listInvoices(req.auth.id);
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function cancel(req: IRequest, res: Response, next: NextFunction) {
  try {
    await service.ensureBillingUser(req.auth.id);
    const {message, data} = await service.cancelSubscription(req.auth.id);
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function resume(req: IRequest, res: Response, next: NextFunction) {
  try {
    await service.ensureBillingUser(req.auth.id);
    const {message, data} = await service.resumeSubscription(req.auth.id);
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}
