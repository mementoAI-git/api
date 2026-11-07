/**
 * Keeps chat replies from pointing at Memento pages they should not: a story
 * link must be one of the stories the reply was given, and a share link must
 * be for a story visible to everyone. Anything else keeps its words and loses
 * its link. Works on the stream, holding back only an unfinished link.
 */

export type ChatLinkTarget = {
  type: 'story' | 'conversation';
  /** Stories visible to everyone have a public /post link. */
  shareable?: boolean;
};

export type ChatLinks = {
  /** The app's origin, for share links and absolute Memento URLs. */
  origin?: string;
  targets: Map<string, ChatLinkTarget>;
};

const OBJECT_ID = '[0-9a-fA-F]{24}';
const STORY_PATH = new RegExp(`^/stories/(${OBJECT_ID})/?$`);
const CHAT_PATH = new RegExp(`^/chat/(${OBJECT_ID})/?$`);
const POST_PATH = new RegExp(`^/post/(${OBJECT_ID})/?$`);
const TOKEN =
  /\[([^\]\n]{1,300})\]\(([^)\s]{1,500})\)|(https?:\/\/[^\s<>()[\]]+)/g;
/** Longest stretch held back waiting for a link to finish. */
const MAX_PENDING = 600;

function originHost(origin?: string): string | undefined {
  try {
    return origin ? new URL(origin).host.replace(/^www\./, '') : undefined;
  } catch {
    return undefined;
  }
}

/** The path of a Memento URL (relative, or on the app's origin), else undefined. */
function mementoPath(url: string, host?: string): string | undefined {
  if (url.startsWith('/') && !url.startsWith('//')) return url.split(/[?#]/)[0];
  if (!host) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.host.replace(/^www\./, '') === host
      ? parsed.pathname
      : undefined;
  } catch {
    return undefined;
  }
}

/** The link to keep for a Memento path, or null to drop it. */
function allowed(path: string, links: ChatLinks): string | null {
  const story = path.match(STORY_PATH);
  if (story) {
    return links.targets.get(story[1])?.type === 'story'
      ? `/stories/${story[1]}`
      : null;
  }
  const chat = path.match(CHAT_PATH);
  if (chat) {
    return links.targets.get(chat[1])?.type === 'conversation'
      ? `/chat/${chat[1]}`
      : null;
  }
  const post = path.match(POST_PATH);
  if (post && links.origin && links.targets.get(post[1])?.shareable) {
    return `${links.origin}/post/${post[1]}`;
  }
  return null;
}

/** Checks every complete link in `text`. */
export function rewriteChatLinks(text: string, links: ChatLinks): string {
  const host = originHost(links.origin);
  return text.replace(
    TOKEN,
    (match, label: string | undefined, href: string | undefined, bare) => {
      if (href !== undefined) {
        const path = mementoPath(href, host);
        if (path === undefined) return match;
        const kept = allowed(path, links);
        return kept ? `[${label}](${kept})` : (label as string);
      }
      const url = String(bare).replace(/[.,!?;:'"]+$/, '');
      const tail = String(bare).slice(url.length);
      const path = mementoPath(url, host);
      if (path === undefined) return match;
      const kept = allowed(path, links);
      return kept ? `${kept}${tail}` : tail;
    },
  );
}

/** Where an unfinished link starts at the end of `text`, if one does. */
function pendingFrom(text: string): number {
  let from = text.length;
  const open = text.lastIndexOf('[');
  if (open >= 0) {
    const rest = text.slice(open);
    if (/^\[[^\]\n]*(\](\([^)\s]*)?)?$/.test(rest)) from = open;
  }
  const url = text.match(
    /(?:^|\s)(h(?:t(?:t(?:p(?:s?(?::(?:\/\/?\S*)?)?)?)?)?)?)$/,
  );
  if (url) from = Math.min(from, text.length - url[1].length);
  return text.length - from > MAX_PENDING ? text.length : from;
}

/** Feeds the reply through link checks as it streams. */
export function createChatLinkFilter(links: ChatLinks) {
  let held = '';
  return {
    push(chunk: string): string {
      held += chunk;
      const cut = pendingFrom(held);
      const ready = held.slice(0, cut);
      held = held.slice(cut);
      return ready ? rewriteChatLinks(ready, links) : '';
    },
    flush(): string {
      const rest = held;
      held = '';
      return rest ? rewriteChatLinks(rest, links) : '';
    },
  };
}
