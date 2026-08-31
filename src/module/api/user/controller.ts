import {NextFunction, Response} from 'express';
import * as service from './service';
import {
  getFiles,
  responsHandler,
  validateRequest,
} from '../../../utils/helpers';
import {StatusCodes} from 'http-status-codes';
import {IRequest} from '../../../utils/interface';
import logger from '../../../utils/logger';
import {resolveUploadReservationId} from '../file/upload-idempotency';
import {recordCompatibilityUse} from '../../../services/compatibility-telemetry';

export async function updateProfile(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    validateRequest(req);

    const {message, data} = await service.updateProfile(
      req.body,
      req.auth.id,
      req.context?.client || 'legacy-unknown',
    );

    if (req.body.push_token) {
      void recordCompatibilityUse(
        'compat.push.legacy_profile_token',
        req.context,
      );
      logger.info(
        {
          event: 'compat.push.legacy_profile_token',
          client: req.context?.client || 'legacy-unknown',
          version: req.context?.version,
          build: req.context?.build,
        },
        'Legacy profile push token bridge used',
      );
    }

    const deprecatedPost = req.method === 'POST';
    if (deprecatedPost) {
      void recordCompatibilityUse('compat.users.profile_post', req.context);
      logger.info(
        {
          event: 'compat.users.profile_post',
          client: req.context?.client || 'legacy-unknown',
          version: req.context?.version,
          build: req.context?.build,
        },
        'Deprecated profile update alias used',
      );
    }

    return responsHandler(res, StatusCodes.OK, message, data, {
      deprecations: deprecatedPost ? ['USERS_PROFILE_POST'] : undefined,
    });
  } catch (error) {
    next(error);
  }
}

export async function getProfile(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const {message, data} = await service.getProfile(req.auth.id);

    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function setPassword(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    validateRequest(req);
    const {message, data} = await service.setPassword(req.body, req.auth.id);

    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function getContext(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const {data} = await service.getPersona(req.auth.id);
    return responsHandler(
      res,
      StatusCodes.OK,
      'User context retrieved successfully',
      data,
    );
  } catch (error) {
    next(error);
  }
}

export async function uploadPicture(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const files = getFiles(req, true);
    const {message, data} = await service.uploadPicture(
      files,
      req.auth.id,
      resolveUploadReservationId(
        req.header('Idempotency-Key'),
        req.context?.requestId,
        'user:picture',
      ),
    );
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function verifyTOTP(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    validateRequest(req);
    const {message, data} = await service.verifyTOTP(req.body, req.auth.id);
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function setup2FA(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const {message, data} = await service.setup2FA(req.auth.id);
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function disable2FA(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const {message, data} = await service.disable2FA(req.auth.id);
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function completeOnboarding(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const {message, data} = await service.completeOnboarding(
      req.auth.id,
      req.body,
    );
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function getPersona(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const {message, data} = await service.getPersona(req.auth.id);
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function getMemoryInsightsSummary(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const refresh = req.query?.refresh === '1' || req.query?.refresh === 'true';
    const {message, data} = await service.getMemoryInsightsSummary(
      req.auth.id,
      refresh,
    );
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function updateContext(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const {message, data} = await service.updateContext(req.body, req.auth.id);
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function deleteUser(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const {message, data} = await service.deleteUser(req.auth.id);
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function getUserStats(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const {message, data} = await service.getUserStats(req.auth.id);
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function onboarding(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const {message, data} = await service.onboarding(req.body, req.auth!.id);
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function skipOnboarding(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const {message, data} = await service.skipOnboarding(req.auth!.id);
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function getOnboardingDetails(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const {message, data} = await service.getOnboardingDetails(req.auth!.id);
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function onboardingChatPrompt(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const requestStart = Date.now();
    const {stream, memoryId, latestUserMessage, trailer, skipPersistence} =
      await service.streamOnboardingChatPrompt(req.body, req.auth!.id);

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    /** Avoid reverse-proxy buffering so the browser receives incremental chunks */
    res.setHeader('X-Accel-Buffering', 'no');
    let assistantText = '';

    try {
      for await (const chunk of stream) {
        if (chunk.text) {
          assistantText += chunk.text;
          res.write(chunk.text);
        }
      }
    } catch (streamError) {
      console.error('Onboarding stream error', {
        userId: req.auth!.id,
        error: (streamError as Error)?.message,
      });
      res.write('I hit a temporary issue. Please try again.');
    } finally {
      if (!skipPersistence) {
        await service.persistOnboardingChatTurn(
          req.auth!.id,
          memoryId,
          latestUserMessage,
          assistantText,
        );
      }
      res.write(`\n__MEMENTO_ONBOARDING__${JSON.stringify(trailer)}`);
      res.end();
      console.log('Onboarding stream complete', {
        userId: req.auth!.id,
        durationMs: Date.now() - requestStart,
        memoryId,
      });
    }
  } catch (error) {
    next(error);
  }
}
export async function listPasskeys(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const {message, data} = await service.listPasskeys(req.auth!.id);
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}

export async function deletePasskey(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const credential_id = String(req.params.credential_id);
    const {message, data} = await service.deletePasskey(
      req.auth!.id,
      credential_id,
    );
    return responsHandler(res, StatusCodes.OK, message, data);
  } catch (error) {
    next(error);
  }
}
