import {describe, expect, it} from 'vitest';

import {pack, similarity, textHash} from '../../src/services/embeddings';

describe('embedding packing', () => {
  it('keeps similarity close to the true cosine after packing to 8 bits', () => {
    const a = [0.3, -0.2, 0.9, 0.1, -0.4];
    const b = [0.25, -0.1, 0.8, 0.3, -0.5];
    const dot = a.reduce((sum, x, i) => sum + x * b[i], 0);
    const cosine = dot / (Math.hypot(...a) * Math.hypot(...b));

    expect(similarity(pack(a), pack(b))).toBeCloseTo(cosine, 1);
    expect(Math.abs(similarity(pack(a), pack(b)) - cosine)).toBeLessThan(0.02);
  });

  it('rates a vector as most similar to itself', () => {
    const a = pack([1, 2, 3]);
    expect(similarity(a, a)).toBeGreaterThan(0.99);
    expect(similarity(a, pack([-1, -2, -3]))).toBeLessThan(-0.99);
  });

  it('stores one byte per dimension', () => {
    expect(pack(new Array(768).fill(0.1)).length).toBe(768);
  });

  it('hashes text stably, to skip re-embedding unchanged text', () => {
    expect(textHash('hello')).toBe(textHash('hello'));
    expect(textHash('hello')).not.toBe(textHash('hello!'));
  });
});
