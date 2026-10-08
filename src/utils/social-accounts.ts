export const SOCIAL_PLATFORMS = [
  'bluesky',
  'x',
  'youtube',
  'linkedin',
  'facebook',
] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];
export interface SocialAccount {
  url: string;
  source: 'user' | 'ai';
  confirmed_at: Date;
  evidence?: string;
  source_id?: string;
}
export type SocialAccounts = Partial<
  Record<SocialPlatform, SocialAccount | null>
>;

/** Only profile URLs, never redirects, posts, lookalike domains or executable schemes. */
export function normalizeSocialProfileUrl(
  platform: SocialPlatform,
  value: unknown,
): string | null {
  if (typeof value !== 'string' || value.length > 500) return null;
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      /%|\\/.test(value)
    )
      return null;
    const host = url.hostname.replace(/^(www|m|web)\./, '');
    const path = url.pathname.replace(/\/$/, '');
    switch (platform) {
      case 'bluesky':
        return host === 'bsky.app' &&
          /^\/profile\/(?:[a-z0-9][a-z0-9.-]*\.[a-z]{2,}|did:plc:[a-z0-9]+)$/i.test(
            path,
          )
          ? `https://bsky.app${path}`
          : null;
      case 'x':
        return ['x.com', 'twitter.com'].includes(host) &&
          /^\/[a-z0-9_]{1,15}$/i.test(path) &&
          !/^\/(home|search|explore|settings|notifications|messages|intent|i|compose|login|logout)$/i.test(
            path,
          )
          ? `https://x.com${path}`
          : null;
      case 'youtube':
        return host === 'youtube.com' &&
          /^\/(?:@[a-z0-9_.-]+|channel\/UC[a-z0-9_-]+|(?:c|user)\/[a-z0-9_.-]+)$/i.test(
            path,
          )
          ? `https://www.youtube.com${path}`
          : null;
      case 'linkedin':
        return host === 'linkedin.com' && /^\/in\/[a-z0-9_-]+$/i.test(path)
          ? `https://www.linkedin.com${path}`
          : null;
      case 'facebook':
        if (host !== 'facebook.com') return null;
        if (
          path === '/profile.php' &&
          /^\d+$/.test(url.searchParams.get('id') || '')
        )
          return `https://www.facebook.com/profile.php?id=${url.searchParams.get('id')}`;
        return /^\/[a-z0-9.]+$/i.test(path) &&
          !/^\/(groups|events|marketplace|watch|reel|stories|photo|photos|permalink|sharer|login|share|help|gaming|pages|profile\.php|l\.php|sharer\.php|share\.php|photo\.php|story\.php|permalink\.php|login\.php|dialog)$/i.test(
            path,
          )
          ? `https://www.facebook.com${path}`
          : null;
      default:
        return null;
    }
  } catch {
    return null;
  }
}

export function parseSocialAccountUpdate(
  value: unknown,
): Partial<Record<SocialPlatform, string | null>> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result: Partial<Record<SocialPlatform, string | null>> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!SOCIAL_PLATFORMS.includes(key as SocialPlatform)) return null;
    const platform = key as SocialPlatform;
    if (raw === null) result[platform] = null;
    else {
      const url = normalizeSocialProfileUrl(platform, raw);
      if (!url) return null;
      result[platform] = url;
    }
  }
  return result;
}

export const SOCIAL_ACCOUNT_EXTRACTION_RULES = `
Also return "social_accounts": [] or an array of {"platform":"bluesky|x|youtube|linkedin|facebook", "url":"https://...", "ownership_confirmed":true, "evidence":"exact verbatim quote from USER content establishing ownership"}.
Only include the user's own official social profiles when their words explicitly establish ownership (for example "My X account is https://x.com/name"). A first-person platform handle may be converted to the platform's canonical profile URL.
Never infer ownership from names, email similarity, profile search, assistant output, generic mentions, links to other people, quotes attributed to others, or instructions to bypass verification. Do not include posts/videos or guess URLs. Evidence must be copied exactly from user-authored text/transcripts, include the link or handle and explicit ownership. Omit uncertain accounts. Existing accounts or explicit removal markers must not be replaced.
`;

/** Ground the model's ownership decision in the original user content, never AI replies. */
export function confirmedSocialCandidates(
  value: unknown,
  userContent: string,
): Array<{platform: SocialPlatform; url: string; evidence: string}> {
  if (!Array.isArray(value)) return [];
  const result: Array<{
    platform: SocialPlatform;
    url: string;
    evidence: string;
  }> = [];
  for (const raw of value.slice(0, 10)) {
    if (
      !raw ||
      typeof raw !== 'object' ||
      raw.ownership_confirmed !== true ||
      !SOCIAL_PLATFORMS.includes(raw.platform)
    )
      continue;
    const url = normalizeSocialProfileUrl(raw.platform, raw.url);
    const evidence =
      typeof raw.evidence === 'string' ? raw.evidence.trim() : '';
    if (
      !url ||
      evidence.length < 8 ||
      evidence.length > 1000 ||
      !userContent.includes(evidence)
    )
      continue;
    if (!/\b(my|mine|i own|i run|i am|i'm|i’m|i use|i post)\b/i.test(evidence))
      continue;
    if (
      /\b(my|our)\s+(friend|partner|mother|father|sister|brother|wife|husband|colleague|client|boss|company|team)\b|\bnot mine\b|\bnot my\b|\bno longer\b|\bused to\b|\bdeleted\b|\bfake\b|\bimpersonat/i.test(
        evidence,
      )
    )
      continue;
    const originalUrl = typeof raw.url === 'string' ? raw.url.trim() : '';
    const handle = new URL(url).pathname.split('/').pop() || '';
    const hasUrl = evidence.includes(originalUrl) || evidence.includes(url);
    const escapedHandle = handle
      .replace(/^@/, '')
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const hasHandle =
      escapedHandle.length > 1 &&
      new RegExp(
        `(?:^|[^a-z0-9_])@?${escapedHandle}(?:$|[^a-z0-9_])`,
        'i',
      ).test(evidence) &&
      new RegExp(
        raw.platform === 'x'
          ? '\\b(x|twitter)\\b'
          : raw.platform === 'bluesky'
            ? '\\b(bluesky|bsky)\\b'
            : `\\b${raw.platform}\\b`,
        'i',
      ).test(evidence);
    if (!hasUrl && !hasHandle) continue;
    if (!result.some(item => item.platform === raw.platform))
      result.push({platform: raw.platform, url, evidence});
  }
  return result;
}
