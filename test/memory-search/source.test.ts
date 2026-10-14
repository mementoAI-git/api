import {describe, expect, it} from 'vitest';
import Memory from '../../src/module/database/model/memory';
import {
  fingerprint,
  textChunks,
  rankMemories,
  VECTOR_VERSION,
} from '../../src/services/memory-search/source';

const story = {
  _id: 'm1',
  user: 'owner',
  type: 'story',
  status: 'save',
  title: 'Starting out',
  body: '<p>We rented a tiny apartment.</p>',
  tags: [],
  attachments: [],
};

describe('memory search source and ranking', () => {
  it('fingerprints relevant content, not unrelated activity timestamps', () => {
    const opened = {...story, last_opened: new Date()};
    expect(fingerprint(story, [])).toBe(fingerprint(opened, []));
    expect(fingerprint(story, [])).not.toBe(
      fingerprint({...story, body: 'A different life'}, []),
    );
    expect(fingerprint(story, [])).not.toBe(
      fingerprint({...story, status: 'deleted'}, []),
    );
    expect(fingerprint(story, [])).not.toBe(
      fingerprint({...story, attachments: ['f1']}, []),
    );
  });

  it('invalidates photo vectors when the file is replaced, deleted or no longer owned', () => {
    const memory = {...story, attachments: ['f1']};
    const file = {
      _id: 'f1',
      name: 'photo.jpg',
      user: 'owner',
      type: 'image/jpeg',
      size: 100,
      updated_at: '2026-10-01',
    };
    const before = fingerprint(memory, [file]);
    expect(before).not.toBe(
      fingerprint(memory, [{...file, updated_at: '2026-10-02'}]),
    );
    expect(before).not.toBe(fingerprint(memory, []));
  });

  it('chunks the whole story with bounded inputs and no HTML', () => {
    const chunks = textChunks(
      'A title',
      '<p>' + 'A family story. '.repeat(500) + '</p>',
    );
    expect(chunks.length).toBeGreaterThan(1);
    expect(
      chunks.every(chunk => chunk.length < 2000 && !chunk.includes('<p>')),
    ).toBe(true);
    expect(chunks[0]).toContain('title: A title | text:');
    expect(() => textChunks('Too large', 'x'.repeat(500_000))).toThrow(
      /large/i,
    );
  });

  it('combines exact words with meaning and rejects stale or incompatible vectors', () => {
    const fresh = {
      ...story,
      search_index: {
        fingerprint: fingerprint(story, []),
        version: VECTOR_VERSION,
        chunks: [{kind: 'story' as const, vector: [1, 0]}],
      },
    };
    const other = {
      ...story,
      _id: 'm2',
      title: 'Our first home',
      body: 'A home we loved',
    };
    expect(
      rankMemories([fresh, other], [], 'our first home', [1, 0]).map(
        row => row.id,
      ),
    ).toEqual(['m2', 'm1']);
    expect(
      rankMemories([{...fresh, body: 'Edited'}], [], 'our first home', [1, 0]),
    ).toEqual([]);
    expect(
      rankMemories(
        [{...fresh, search_index: {...fresh.search_index, version: 'old'}}],
        [],
        'our first home',
        [1, 0],
      ),
    ).toEqual([]);
    expect(rankMemories([fresh], [], 'unrelated', [0, 1])).toEqual([]);
  });

  it('never serializes the private index, even when explicitly selected internally', () => {
    const memory = new Memory({
      ...story,
      search_index: {
        fingerprint: 'private',
        version: VECTOR_VERSION,
        chunks: [{kind: 'story', vector: [1, 0]}],
      },
    });
    expect(memory.toJSON()).not.toHaveProperty('search_index');
    expect(memory.toObject()).not.toHaveProperty('search_index');
  });

  it('does not rank a single shared word above a strong photo match', () => {
    const photo = {
      ...story,
      title: 'Photo',
      body: '',
      search_index: {
        fingerprint: '',
        version: VECTOR_VERSION,
        chunks: [{kind: 'photo' as const, vector: [1, 0]}],
      },
    };
    photo.search_index.fingerprint = fingerprint(photo, []);
    const partial = {
      ...story,
      _id: 'm2',
      title: 'An orange tree',
      body: 'Fruit in the garden',
    };
    expect(
      rankMemories(
        [partial, photo],
        [],
        'an orange tabby with whiskers',
        [1, 0],
      ).map(row => row.id),
    ).toEqual(['m1']);
  });

  it('supports a small collection with exactly four indexed stories', () => {
    const memories = Array.from({length: 4}, (_, index) => {
      const memory = {
        ...story,
        _id: `m${index}`,
        title: `Entry ${index}`,
        body: '',
        search_index: {
          version: VECTOR_VERSION,
          fingerprint: '',
          chunks: [
            {kind: 'story' as const, vector: index === 0 ? [1, 0] : [0, 1]},
          ],
        },
      };
      memory.search_index.fingerprint = fingerprint(memory, []);
      return memory;
    });
    expect(
      rankMemories(memories, [], 'our first home', [1, 0]).map(row => row.id),
    ).toEqual(['m0']);
  });
});
