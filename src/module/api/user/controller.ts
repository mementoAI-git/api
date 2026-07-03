import {NextFunction, Response} from 'express';
import * as service from './service';
import {
  getFiles,
  responsHandler,
  validateRequest,
} from '../../../utils/helpers';
import {StatusCodes} from 'http-status-codes';
import {IRequest} from '../../../utils/interface';

export async function updateProfile(
  req: IRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    validateRequest(req);

    const {message, data} = await service.updateProfile(req.body, req.auth.id);

    return responsHandler(res, StatusCodes.OK, message, data);
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
    const {message, data} = await service.setPassword(req.body, req.auth.id);

    return responsHandler(res, StatusCodes.OK, message, data);
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
    const {message, data} = await service.uploadPicture(files, req.auth.id);
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
