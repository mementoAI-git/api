/** Shared save-time name for automatic and explicit quick captures. */
export const QUICK_NOTE_TITLE = 'Quick note';

export const GENERIC_QUICK_CAPTURE_TITLE_RE =
  /^(thought|thoughts|quick capture|quick note|a note|note|memory|untitled|new memory|my thought|a passing thought|voice note|photo note|journal entry)\.?$/i;

export function shouldOverwriteQuickCaptureTitle(
  currentTitle: string,
  promptLinked = false,
): boolean {
  const title = (currentTitle || '').trim();
  // Keep the product label for ordinary notes; reflections still get descriptive titles.
  if (title === QUICK_NOTE_TITLE && !promptLinked) return false;
  return !title || GENERIC_QUICK_CAPTURE_TITLE_RE.test(title);
}
