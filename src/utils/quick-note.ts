/**
 * Placeholder title for a story saved without one. Background enrichment replaces it
 * with a human-readable title once it has read what was added.
 */
export const QUICK_NOTE_TITLE = 'Quick note';

/**
 * Placeholder for captures that ask to be named (`auto_title`). It matches
 * GENERIC_QUICK_CAPTURE_TITLE_RE, so the enrichment worker replaces it with
 * an AI title from the transcript, and it stays when nothing could be heard.
 */
export const AUTO_TITLE_PLACEHOLDER = 'Voice note';

export const GENERIC_QUICK_CAPTURE_TITLE_RE =
  /^(thought|thoughts|quick capture|quick note|a note|note|memory|untitled|new memory|my thought|a passing thought|voice note|photo note|journal entry)\.?$/i;

/** True while a story still carries a placeholder rather than a title the member wrote. */
export function shouldOverwriteQuickCaptureTitle(
  currentTitle: string,
): boolean {
  const title = (currentTitle || '').trim();
  return !title || GENERIC_QUICK_CAPTURE_TITLE_RE.test(title);
}

type AttachmentKind = 'photo' | 'video' | 'recording' | 'file';

function kindOf(mime: string): AttachmentKind {
  if (/^image\//i.test(mime)) return 'photo';
  if (/^video\/webm/i.test(mime) || /^audio\//i.test(mime)) return 'recording';
  if (/^video\//i.test(mime)) return 'video';
  return 'file';
}

const KIND_LABEL: Record<AttachmentKind, [string, string]> = {
  photo: ['Photo', 'Photos'],
  video: ['Video', 'Videos'],
  recording: ['Voice recording', 'Voice recordings'],
  file: ['File', 'Files'],
};

/**
 * Readable title for a story with nothing to read: names what was attached and when,
 * for example "Photos from 11 November" or "Voice recording from 3 March".
 */
export function attachmentOnlyTitle(
  mimeTypes: string[],
  savedAt: Date,
): string {
  const date = savedAt.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
  const kinds = mimeTypes.map(kindOf);
  if (!kinds.length) return `Note from ${date}`;
  const unique = [...new Set(kinds)];
  if (unique.length > 1) return `Media from ${date}`;
  const [single, plural] = KIND_LABEL[unique[0]];
  return `${kinds.length > 1 ? plural : single} from ${date}`;
}
