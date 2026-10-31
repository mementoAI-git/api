import {describe, expect, it} from 'vitest';
import {
  QUICK_NOTE_TITLE,
  shouldOverwriteQuickCaptureTitle,
} from '../../src/utils/quick-note';

describe('quick-note saving nomenclature', () => {
  it('uses Quick note across save paths', () => {
    expect(QUICK_NOTE_TITLE).toBe('Quick note');
  });
  it('keeps Quick note during background enrichment', () => {
    expect(shouldOverwriteQuickCaptureTitle('Quick note')).toBe(false);
    expect(shouldOverwriteQuickCaptureTitle(' Quick note ')).toBe(false);
  });
  it('continues enriching prompt-linked reflections', () => {
    expect(shouldOverwriteQuickCaptureTitle('Quick note', true)).toBe(true);
    expect(shouldOverwriteQuickCaptureTitle('My afternoon', true)).toBe(false);
  });
  it('preserves authored titles while continuing to enrich legacy placeholders', () => {
    expect(shouldOverwriteQuickCaptureTitle('My afternoon')).toBe(false);
    expect(shouldOverwriteQuickCaptureTitle('Thought')).toBe(true);
    expect(shouldOverwriteQuickCaptureTitle('')).toBe(true);
  });
});
