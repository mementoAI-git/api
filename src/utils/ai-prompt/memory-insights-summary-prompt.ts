/** Single user message for {@link import('../../services/ai').default.generateText}. */
export function buildMemoryInsightsSummaryRequest(pack: string): string {
  return `You are writing a brief "who I am" profile for the member of a private reflection app. Use ONLY the information in SOURCES below. Do not invent biographical facts, names, or events. If something is unclear, omit it.

Write exactly two paragraphs of plain prose (no markdown, no bullets, no titles).
- First person only: "I" and "my".
- Warm and specific. Avoid generic filler.
- Do not mention "the user", "the host", "sources", "context", or any product name.
- If SOURCES are very thin, write a short, honest first-person reflection on what little is known — still two short paragraphs.
- Maximum about 130 words total.

SOURCES:
${pack}

Write only the two paragraphs, separated by one blank line.`;
}

export function normalizeMemoryInsightsSummaryOutput(raw: string): string {
  let t = raw.replace(/\r\n/g, '\n').trim();
  t = t
    .replace(/^```[\w]*\n?/i, '')
    .replace(/\n?```$/i, '')
    .trim();
  t = t.replace(/\n{3,}/g, '\n\n');
  return t.trim();
}
