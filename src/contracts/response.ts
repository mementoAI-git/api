export const CONTRACT_VERSION = '2026-08' as const;

export type MementoClient = 'web' | 'ios' | 'android' | 'legacy-unknown';

export type RequestContext = {
  requestId: string;
  client: MementoClient;
  version: string | null;
  build: string | null;
};

export type ApiResponse<T> = {
  status: number;
  success: true;
  message: string;
  data: T;
  meta: {
    contract_version: typeof CONTRACT_VERSION;
    request_id: string;
    deprecations?: string[];
  };
};

export type ErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'payment_required'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'payload_too_large'
  | 'validation_failed'
  | 'rate_limited'
  | 'session_expired'
  | 'bad_gateway'
  | 'service_unavailable'
  | 'internal_error'
  | 'request_failed';

export type ApiError = {
  status: number;
  success: false;
  message: string;
  code: ErrorCode;
  details?: Record<string, unknown>;
  request_id: string;
};

export function defaultErrorCode(status: number): ErrorCode {
  switch (status) {
    case 400:
      return 'bad_request';
    case 401:
      return 'unauthorized';
    case 402:
      return 'payment_required';
    case 403:
      return 'forbidden';
    case 404:
      return 'not_found';
    case 409:
      return 'conflict';
    case 413:
      return 'payload_too_large';
    case 422:
      return 'validation_failed';
    case 429:
      return 'rate_limited';
    case 440:
      return 'session_expired';
    case 502:
      return 'bad_gateway';
    case 503:
      return 'service_unavailable';
    case 500:
      return 'internal_error';
    default:
      return 'request_failed';
  }
}
