import {createHash} from 'node:crypto';
import {escapeHtml} from '../public-profile/view';

/**
 * The page link previews read for a shared story (/post/:id). nginx sends
 * preview crawlers (WhatsApp, Slack, iMessage, social sites) here; people
 * get the app itself. Only stories visible to everyone are served.
 */

export type PublicStoryView = {
  id: string;
  title?: string;
  body?: string;
  attachments?: {url?: string; thumbnail?: string | null; type?: string}[];
};

const DESCRIPTION_LENGTH = 180;

const styles = `:root{color-scheme:light dark;font-family:system-ui,sans-serif;background:#f8f7f5;color:#21170f}body{margin:0;display:grid;min-height:100vh;place-items:center;padding:24px;box-sizing:border-box}main{max-width:560px}img{width:100%;border-radius:16px;object-fit:cover;max-height:320px}h1{font-size:28px;margin:20px 0 8px}p{line-height:1.6;color:#5c5047}a{display:inline-block;margin-top:16px;padding:10px 18px;border-radius:999px;background:#f0743e;color:#fff;text-decoration:none;font-weight:600}@media (prefers-color-scheme:dark){:root{background:#15130f;color:#f4efe9}p{color:#bdb3a8}}`;

export const STORY_CSP = `default-src 'none'; style-src 'sha256-${createHash('sha256').update(styles).digest('base64')}'; img-src https: data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;

export function storyExcerpt(body = '', max = DESCRIPTION_LENGTH): string {
  const text = body
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

export function renderPublicStory(
  story: PublicStoryView,
  frontendUrl: string,
): string {
  const origin = new URL(frontendUrl).origin;
  const url = `${origin}/post/${story.id}`;
  const cover = story.attachments?.find(
    file => file.thumbnail || file.type?.startsWith('image'),
  );
  const coverUrl = cover?.thumbnail || cover?.url;
  const image =
    coverUrl && /^https:\/\//.test(coverUrl)
      ? coverUrl
      : `${origin}/android-chrome-512x512.png`;
  const heading = story.title?.trim() || 'A story';
  const title = escapeHtml(`${heading} · Memento`);
  const description = escapeHtml(
    storyExcerpt(story.body) || 'A story shared on Memento.',
  );
  const card = coverUrl ? 'summary_large_image' : 'summary';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><meta name="description" content="${description}"><meta name="robots" content="noindex,nofollow"><link rel="canonical" href="${escapeHtml(url)}"><meta property="og:type" content="article"><meta property="og:site_name" content="Memento"><meta property="og:title" content="${title}"><meta property="og:description" content="${description}"><meta property="og:url" content="${escapeHtml(url)}"><meta property="og:image" content="${escapeHtml(image)}"><meta name="twitter:card" content="${card}"><meta name="twitter:title" content="${title}"><meta name="twitter:description" content="${description}"><meta name="twitter:image" content="${escapeHtml(image)}"><style>${styles}</style></head><body><main>${coverUrl && /^https:\/\//.test(coverUrl) ? `<img src="${escapeHtml(coverUrl)}" alt="">` : ''}<h1>${escapeHtml(heading)}</h1><p>${description}</p><a href="${escapeHtml(url)}">Read it on Memento</a></main></body></html>`;
}
