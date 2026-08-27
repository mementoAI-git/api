import {NextFunction, Request, Response} from 'express';
import {StatusCodes} from 'http-status-codes';
import {
  SENTRY_TUNNEL_ALLOWED_HOSTS,
  SENTRY_TUNNEL_ALLOWED_PROJECT_IDS,
  SENTRY_TUNNEL_MAX_BYTES,
  SENTRY_TUNNEL_TIMEOUT_MS,
} from '../../../utils/config';
import {ServiceError} from '../../../utils/service-error';
import {resolveSentryIngestUrl, SentryTunnelPolicyError} from './policy';

const policy = {
  allowedHosts: new Set(SENTRY_TUNNEL_ALLOWED_HOSTS),
  allowedProjectIds: new Set(SENTRY_TUNNEL_ALLOWED_PROJECT_IDS),
  maxEnvelopeBytes: SENTRY_TUNNEL_MAX_BYTES,
};

export async function tunnel(req: Request, res: Response, next: NextFunction) {
  try {
    if (!Buffer.isBuffer(req.body)) {
      throw new ServiceError(
        'Invalid Sentry envelope',
        StatusCodes.BAD_REQUEST,
      );
    }
    const sentryIngestUrl = resolveSentryIngestUrl(req.body, policy);

    const upstreamRes = await fetch(sentryIngestUrl.toString(), {
      method: 'POST',
      body: req.body,
      headers: {'Content-Type': 'application/x-sentry-envelope'},
      signal: AbortSignal.timeout(SENTRY_TUNNEL_TIMEOUT_MS),
    });

    res.status(upstreamRes.status).end();
  } catch (error) {
    if (error instanceof SentryTunnelPolicyError) {
      next(new ServiceError(error.message, error.statusCode));
      return;
    }
    if (error instanceof ServiceError) {
      next(error);
      return;
    }
    next(new ServiceError('Sentry relay failed', StatusCodes.BAD_GATEWAY));
  }
}
