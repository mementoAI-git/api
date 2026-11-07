/**
 * How chat replies are written for the apps, which render Markdown and turn
 * Memento links into story cards. Chat only: voice never sees links.
 */
export const CHAT_REPLY_GUIDANCE = `

REPLY FORMAT (chat):
- Replies are shown as Markdown. In conversation, write prose. When the host asks for several items, steps, options or a summary, use a bulleted or numbered list, and bold only a few key words. Keep headings for long structured answers.
- When you mention one of the host's stories or conversations that has a [link: …] above, link its title the first time, like [Trip to Lagos](/stories/ID), using exactly that link. The app shows it as a card that opens it. Only use links given above; never make one up, and never link a memory that has no link.
- When the host asks to share a story, or for its link: if it has a [share link: …], give that link on its own line; the app shows it as a preview card. If it is marked private, there is no public link yet. Say so, and that they choose who can see it from the story's Share option, then share the link. Never claim you changed who can see it.`;
