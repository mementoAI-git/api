import {readLink, type LinkReading} from './link-reader';

/**
 * Preview details for a link shown in chat: title, site, preview image and
 * icon. Uses the same guarded fetch as link reading, and keeps recent
 * answers so a conversation full of the same link fetches it once.
 */

export type LinkPreview = {
  url: string;
  domain: string;
  title?: string;
  description?: string;
  image?: string;
  favicon?: string;
};

const CACHE_MS = 6 * 60 * 60 * 1000;
const MAX_CACHED = 500;
const cache = new Map<string, {at: number; preview: Promise<LinkPreview>}>();

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function previewFromReading(
  url: string,
  reading: LinkReading,
): LinkPreview {
  const domain = domainOf(reading.url) || domainOf(url);
  if (reading.kind !== 'read') return {url, domain};
  return {
    url,
    domain,
    ...(reading.title && {title: reading.title}),
    ...(reading.description && {description: reading.description}),
    ...(reading.image && {image: reading.image}),
    ...(reading.favicon && {favicon: reading.favicon}),
  };
}

export function previewLink(
  url: string,
  read: (url: string) => Promise<LinkReading> = readLink,
  now = Date.now(),
): Promise<LinkPreview> {
  const hit = cache.get(url);
  if (hit && now - hit.at < CACHE_MS) return hit.preview;
  const preview = read(url)
    .then(reading => previewFromReading(url, reading))
    .catch(() => ({url, domain: domainOf(url)}));
  cache.delete(url);
  cache.set(url, {at: now, preview});
  while (cache.size > MAX_CACHED) {
    cache.delete(cache.keys().next().value as string);
  }
  return preview;
}

export function clearLinkPreviewCache() {
  cache.clear();
}
