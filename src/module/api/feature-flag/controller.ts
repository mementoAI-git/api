import {NextFunction, Response} from 'express';
import {StatusCodes} from 'http-status-codes';
import {IRequest} from '../../../utils/interface';
import {responsHandler} from '../../../utils/helpers';
import * as service from './service';

export async function listFlags(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const {message, data} = await service.listFeatureFlags({
      page: Number(req.query.page || 1),
      limit: Number(req.query.limit || 25),
      search: String(req.query.search || ''),
      domain: req.query.domain ? String(req.query.domain) : undefined,
    });
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function getFlag(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const {message, data} = await service.getFeatureFlagDetail(
      String(req.params.key),
    );
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function evaluateFlag(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const data = await service.evaluateFeatureFlag(String(req.params.key), {
      userId: req.auth?.id,
    });
    return responsHandler(res, StatusCodes.OK, 'Feature flag evaluated', data);
  } catch (error) {
    next(error);
  }
}

export async function updateDefault(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const {message, data} = await service.updateDefaultValue({
      key: String(req.params.key),
      value: Boolean(req.body?.value),
      actor: req.auth?.id,
      reason: req.body?.reason,
    });
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function upsertOverride(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const {message, data} = await service.upsertOverride({
      key: String(req.params.key),
      scopeType: req.params.scopeType as 'global' | 'environment' | 'user',
      scopeId: String(req.params.scopeId),
      value: Boolean(req.body?.value),
      rolloutPercentage:
        req.body?.rolloutPercentage === undefined
          ? undefined
          : Number(req.body.rolloutPercentage),
      actor: req.auth?.id,
      reason: req.body?.reason,
    });
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function removeOverride(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const {message, data} = await service.deleteOverride({
      key: String(req.params.key),
      scopeType: req.params.scopeType as 'global' | 'environment' | 'user',
      scopeId: String(req.params.scopeId),
      actor: req.auth?.id,
      reason: req.body?.reason,
    });
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function updateRollout(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const {message, data} = await service.updateRollout({
      key: String(req.params.key),
      scopeType: req.params.scopeType as 'global' | 'environment' | 'user',
      scopeId: String(req.params.scopeId),
      rolloutPercentage:
        req.body?.rolloutPercentage === null
          ? null
          : Number(req.body?.rolloutPercentage),
      actor: req.auth?.id,
      reason: req.body?.reason,
    });
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function audit(req: IRequest, res: Response, next: NextFunction) {
  try {
    const {message, data} = await service.getFlagAudit(
      String(req.params.key),
      Number(req.query.limit || 50),
    );
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function bulk(req: IRequest, res: Response, next: NextFunction) {
  try {
    const {message, data} = await service.bulkSetByPrefix({
      prefix: String(req.body?.prefix || ''),
      value: Boolean(req.body?.value),
      actor: req.auth?.id,
      reason: req.body?.reason,
    });
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}
