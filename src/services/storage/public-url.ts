import {BACKEND_URL} from '../../utils/config';

export function resolvePublicFileUrl(key: string, fallback = ''): string {
  if (BACKEND_URL) {
    const base = BACKEND_URL.replace(/\/$/, '');
    return `${base}/files/${encodeURIComponent(key)}`;
  }
  return fallback;
}
