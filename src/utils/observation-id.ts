import {createHash} from 'crypto';

/** Same wording, ignoring case, spacing and closing punctuation. */
function normalizeObservation(content: string): string {
  return content
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.!]+$/, '');
}

export function observationHash(field: string, content: string): string {
  return createHash('sha256')
    .update(`${field}:${normalizeObservation(content)}`)
    .digest('hex')
    .slice(0, 24);
}

/**
 * Persona observations are bare strings, so their identity comes from their
 * field and wording. This also merges one observation found in many memories.
 */
export function observationId(field: string, content: string): string {
  return `${field}-${observationHash(field, content)}`;
}
