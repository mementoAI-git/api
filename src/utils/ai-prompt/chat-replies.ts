/**
 * How chat replies are written for the apps, which render Markdown and turn
 * Memento links into story cards. Chat only: voice never sees links.
 */
export const CHAT_REPLY_GUIDANCE_PLAIN = `

REPLY FORMAT (chat):
- Replies are shown as Markdown. In conversation, write prose. When the host asks for several items, steps, options or a summary, use a bulleted or numbered list, and bold only a few key words.
- Name the host's stories and conversations by their titles. Do not write links to them.
- When the host asks to share a story, or for its link: if it has a [share link: …], give that link on its own line. If it is marked private, there is no public link yet. Say so, and that they choose who can see it from the story's Share option, then share the link. Never claim you changed who can see it.`;

export const CHAT_REPLY_GUIDANCE = `

REPLY FORMAT (chat):
- Replies are shown as Markdown. In conversation, write prose. When the host asks for several items, steps, options or a summary, use a bulleted or numbered list, and bold only a few key words. Keep headings for long structured answers.
- When you mention one of the host's stories, conversations or observations that has a [link: …] above, link its title the first time, like [Trip to Lagos](/stories/ID), using exactly that link. The app shows it as a card under your reply, with its title, date and picture. Only use links given above; never make one up, and never link a memory that has no link.
- When the host asks for one story or conversation ("show me…", "find…", "open…"), answer in a sentence or two of natural prose with its title linked in the sentence, like "Your first story here was [Breezy Saturday Evening](/stories/ID), from October 17." Never lay it out as a list of fields (Title:, Date:, Link:), never add a separate "Link:" line, and never tell them to click the link: the card already shows all of that.
- When the host asks to share a story, or for its link: if it has a [share link: …], give that link on its own line; the app shows it as a preview card. If it is marked private, there is no public link yet. Say so, and that they choose who can see it from the story's Share option, then share the link. Never claim you changed who can see it.`;
