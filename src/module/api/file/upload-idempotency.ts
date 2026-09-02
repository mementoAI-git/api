import {BadRequestException} from '../../../utils/service-error';

const SAFE_UPLOAD_KEY = /^[A-Za-z0-9._:-]{1,128}$/;

export function resolveUploadReservationId(
  clientKey?: string,
  requestId?: string,
  scope = 'file',
): string | undefined {
  if (clientKey !== undefined) {
    const normalized = clientKey.trim();
    if (!SAFE_UPLOAD_KEY.test(normalized)) {
      throw new BadRequestException('Invalid Idempotency Key');
    }
    return `${scope}:${normalized}`;
  }
  return requestId ? `${scope}:${requestId}` : undefined;
}
