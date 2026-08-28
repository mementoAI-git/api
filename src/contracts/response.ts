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

export type ApiError = {
  status: number;
  success: false;
  message: string;
  code: string;
  details?: Record<string, unknown>;
  request_id: string;
};
