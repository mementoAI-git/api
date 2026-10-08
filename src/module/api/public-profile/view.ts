import {createHash} from 'node:crypto';
import type {ProfileView} from './service';

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    char =>
      ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[
        char
      ]!,
  );
}

const styles = `:root{color-scheme:light dark;font-family:system-ui,sans-serif;background:#f8f7f5;color:#21170f}*{box-sizing:border-box}body{margin:0;padding:32px 20px}header{max-width:760px;margin:auto;font-family:Georgia,serif;font-size:28px}main{max-width:760px;margin:48px auto;background:#fff;border:1px solid #e7e4df;border-radius:24px;overflow:hidden}.banner{height:148px;background:linear-gradient(120deg,#242b40,#121827)}.content{padding:0 32px 32px}.avatar{display:block;width:80px;height:80px;object-fit:cover;border-radius:50%;margin-top:-40px;border:4px solid #fff;background:#ece8e2}.initial{display:grid;place-items:center;font-size:28px;font-weight:600}h1{font-family:Georgia,serif;font-weight:400;font-size:36px;line-height:1.2;margin:24px 0 12px}.label{opacity:.6;font-size:14px}h2{font-size:16px;margin-top:32px}.bio{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.65}footer{max-width:760px;margin:auto;font-size:14px;opacity:.65}footer a{color:inherit}@media(prefers-color-scheme:dark){:root{background:#0d1226;color:#fff}main{background:#191e2c;border-color:#343a49}.avatar{border-color:#191e2c;background:#343a49}}@media(max-width:480px){body{padding:24px 16px}main{margin:32px auto}.content{padding:0 24px 24px}h1{font-size:30px}}`;
export const PROFILE_CSP = `default-src 'none'; style-src 'sha256-${createHash('sha256').update(styles).digest('base64')}'; img-src https: http://localhost:* http://127.0.0.1:*; base-uri 'none'; frame-ancestors 'none'`;

export function renderPublicProfile(
  profile: ProfileView,
  frontendUrl: string,
): string {
  const origin = new URL(frontendUrl).origin;
  const url = `${origin}/profile/${profile.token}`;
  const image = `${origin}/og/profile.png`;
  const name = escapeHtml(profile.display_name);
  const title = escapeHtml(`${profile.display_name} on Memento`);
  const description = escapeHtml(
    profile.bio || `View ${profile.display_name}’s Memento profile.`,
  );
  const picture =
    profile.picture_url && /^https?:\/\//.test(profile.picture_url)
      ? `<img class="avatar" src="${escapeHtml(profile.picture_url)}" alt="${name}" />`
      : `<div class="avatar initial" aria-hidden="true">${escapeHtml(Array.from(profile.display_name)[0] || 'M')}</div>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><meta name="description" content="${description}"><meta name="robots" content="noindex,nofollow"><link rel="canonical" href="${escapeHtml(url)}"><meta property="og:type" content="profile"><meta property="og:site_name" content="Memento"><meta property="og:title" content="${title}"><meta property="og:description" content="${description}"><meta property="og:url" content="${escapeHtml(url)}"><meta property="og:image" content="${escapeHtml(image)}"><meta property="og:image:type" content="image/png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="Memento — a space for your story"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${title}"><meta name="twitter:description" content="${description}"><meta name="twitter:image" content="${escapeHtml(image)}"><style>${styles}</style></head><body><header>Memento.</header><main><div class="banner"></div><div class="content">${picture}<h1>${name}</h1><div class="label">Memento profile</div>${profile.bio ? `<h2>About me</h2><p class="bio">${escapeHtml(profile.bio)}</p>` : ''}</div></main><footer>A space for your story. <a href="${escapeHtml(origin)}">Discover Memento</a></footer></body></html>`;
}
