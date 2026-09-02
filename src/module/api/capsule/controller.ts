import e, {NextFunction, Response} from 'express';
import {IRequest} from '../../../utils/interface';
import {
  getPagination,
  responsHandler,
  validateRequest,
} from '../../../utils/helpers';
import * as service from './service';
import {StatusCodes} from 'http-status-codes';
import {assertAccess} from '../billing/service';

export async function createCapsule(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    validateRequest(req);
    const schedulesDelivery =
      req.body?.status === 'scheduled' ||
      (req.body?.status !== 'draft' && Boolean(req.body?.schedule_date));
    if (schedulesDelivery) {
      await assertAccess(req.auth.id, 'time_capsule_window', {
        deliveryDate: req.body?.schedule_date,
      });
    }
    const {message, data} = await service.createCapsule(req.body, req.auth.id);
    return responsHandler(res, StatusCodes.CREATED, message, data);
  } catch (error) {
    next(error);
  }
}

export async function updateCapsule(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    validateRequest(req);
    if (req.body?.status === 'scheduled') {
      const deliveryDate =
        req.body?.schedule_date ||
        (await service.getCapsuleScheduleDate(
          String(req.params.id),
          req.auth.id,
        ));
      await assertAccess(req.auth.id, 'time_capsule_window', {
        deliveryDate,
      });
    }
    const {message, data} = await service.updateCapsule(
      String(req.params.id),
      req.body,
      req.auth.id,
    );
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function scheduleCapsule(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const deliveryDate = await service.getCapsuleScheduleDate(
      String(req.params.id),
      req.auth.id,
    );
    await assertAccess(req.auth.id, 'time_capsule_window', {deliveryDate});
    const {message, data} = await service.scheduleCapsule(
      String(req.params.id),
      req.auth.id,
    );
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function exchangeExternalViewToken(
  req: e.Request,
  res: Response,
  next: NextFunction,
) {
  try {
    validateRequest(req as IRequest);
    const data = await service.exchangeExternalViewToken(req.body.token);
    res.set({'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer'});
    return responsHandler(res, StatusCodes.OK, 'Capsule link exchanged', data);
  } catch (error) {
    next(error);
  }
}

export async function getExternalCapsule(
  req: e.Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const grant = req.header('x-capsule-view-grant') || '';
    const data = await service.getExternalCapsule(grant);
    res.set({
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex, nofollow',
    });
    return responsHandler(res, StatusCodes.OK, 'Capsule retrieved', data);
  } catch (error) {
    next(error);
  }
}
export async function getCapsules(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    validateRequest(req);
    const {message, data} = await service.getCapsules(
      getPagination(req),
      req.auth.id,
    );
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}
export async function getCapsule(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const {message, data} = await service.getCapsule(
      String(req.params?.id || ''),
      req.auth.id,
    );
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function deleteCapsule(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const {message, data} = await service.deleteCapsule(
      String(req.params?.id || ''),
      req.auth.id,
    );
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function getCapsuleStats(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const {message, data} = await service.getCapsuleStats(req.auth.id);
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}
