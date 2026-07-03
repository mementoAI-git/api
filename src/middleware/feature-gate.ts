import {NextFunction, Response} from 'express';
import {IRequest} from '../utils/interface';
import {ServiceError} from '../utils/service-error';
import {StatusCodes} from 'http-status-codes';
import {evaluateFeatureFlag} from '../module/api/feature-flag/service';
import logger from '../utils/logger';

export function requireFeature(key: string) {
  return async function (req: IRequest, _res: Response, next: NextFunction) {
    try {
      const result = await evaluateFeatureFlag(key, {userId: req.auth?.id});
      logger.info(
        {
          feature: key,
          enabled: result.enabled,
          source: result.source,
          userId: req.auth?.id,
        },
        'Feature gate evaluated',
      );
      if (!result.enabled) {
        logger.warn(
          {feature: key, source: result.source, userId: req.auth?.id},
          'Feature gate blocked request',
        );
        throw new ServiceError(
          `Feature '${key}' is disabled`,
          StatusCodes.PAYMENT_REQUIRED,
          {
            feature: key,
            requiredTier: 'admin_toggle',
            source: result.source,
          },
        );
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
