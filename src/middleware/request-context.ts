import {randomUUID} from 'crypto';
import type {NextFunction, Request, Response} from 'express';
import type {MementoClient, RequestContext} from '../contracts/response';
import type {IRequest} from '../utils/interface';

const CLIENTS = new Set<MementoClient>(['web', 'ios', 'android']);
const MAX_METADATA_LENGTH = 128;
const PRINTABLE_ASCII = /^[\x20-\x7e]+$/;

function headerValue(req: Request, name: string): string | null {
  const value = req.header(name);
  if (
    !value ||
    value.length > MAX_METADATA_LENGTH ||
    !PRINTABLE_ASCII.test(value)
  ) {
    return null;
  }
  return value;
}

export default function requestContext(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const requestedClient = headerValue(req, 'X-Memento-Client')?.toLowerCase();
  const client =
    requestedClient && CLIENTS.has(requestedClient as MementoClient)
      ? (requestedClient as MementoClient)
      : 'legacy-unknown';
  const context: RequestContext = {
    requestId: randomUUID(),
    client,
    version: headerValue(req, 'X-Memento-Version'),
    build: headerValue(req, 'X-Memento-Build'),
  };

  (req as IRequest).context = context;
  res.locals.requestContext = context;
  res.setHeader('X-Request-Id', context.requestId);
  next();
}
