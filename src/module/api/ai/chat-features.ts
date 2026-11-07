/**
 * What the app sending a chat message can show, from the
 * X-Memento-Chat-Features header (a comma list). Older mobile builds send
 * nothing and get plain replies: no in-app story links, no confirmation
 * cards, no status lines, all of which they would show as raw text.
 */
export type ChatFeatures = {
  /** In-app links to stories and conversations ([title](/stories/id)). */
  links: boolean;
  /** memento-confirm / memento-done cards after the reply. */
  cards: boolean;
  /** Status lines before the reply ("Looking through your stories…"). */
  status: boolean;
};

export const PLAIN_CHAT: ChatFeatures = {
  links: false,
  cards: false,
  status: false,
};

export function chatFeaturesFrom(
  header: (name: string) => string | undefined,
): ChatFeatures {
  const listed = new Set(
    String(header('x-memento-chat-features') ?? '')
      .split(',')
      .map(value => value.trim().toLowerCase())
      .filter(Boolean),
  );
  // Web builds before this header already render links and cards.
  const web = String(header('x-memento-client') ?? '').toLowerCase() === 'web';
  return {
    links: listed.has('links') || web,
    cards: listed.has('cards') || web,
    status: listed.has('status'),
  };
}
