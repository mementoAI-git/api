import {describe, expect, it} from 'vitest';
import {
  QUICK_NOTE_TITLE,
  attachmentOnlyTitle,
  shouldOverwriteQuickCaptureTitle,
} from '../../src/utils/quick-note';

describe('quick-note saving nomenclature', () => {
  it('saves untitled stories as Quick note until a title is generated', () => {
    expect(QUICK_NOTE_TITLE).toBe('Quick note');
  });
  it('replaces the Quick note placeholder during background enrichment', () => {
    expect(shouldOverwriteQuickCaptureTitle('Quick note')).toBe(true);
    expect(shouldOverwriteQuickCaptureTitle(' Quick note ')).toBe(true);
  });
  it('preserves authored titles while replacing placeholders', () => {
    expect(shouldOverwriteQuickCaptureTitle('My afternoon')).toBe(false);
    expect(shouldOverwriteQuickCaptureTitle('Thought')).toBe(true);
    expect(shouldOverwriteQuickCaptureTitle('Voice note')).toBe(true);
    expect(shouldOverwriteQuickCaptureTitle('')).toBe(true);
  });
});

describe('attachmentOnlyTitle', () => {
  const day = new Date('2026-11-11T09:00:00Z');
  it('names a single kind of attachment', () => {
    expect(attachmentOnlyTitle(['image/jpeg'], day)).toBe(
      'Photo from 11 November',
    );
    expect(attachmentOnlyTitle(['image/jpeg', 'image/png'], day)).toBe(
      'Photos from 11 November',
    );
    expect(attachmentOnlyTitle(['audio/m4a'], day)).toBe(
      'Voice recording from 11 November',
    );
    expect(attachmentOnlyTitle(['video/webm'], day)).toBe(
      'Voice recording from 11 November',
    );
    expect(attachmentOnlyTitle(['video/mp4'], day)).toBe(
      'Video from 11 November',
    );
    expect(attachmentOnlyTitle(['application/pdf'], day)).toBe(
      'File from 11 November',
    );
  });
  it('names mixed attachments as media', () => {
    expect(attachmentOnlyTitle(['image/jpeg', 'video/mp4'], day)).toBe(
      'Media from 11 November',
    );
  });
});
