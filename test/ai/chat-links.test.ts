import {describe, expect, it} from 'vitest';
import {
  createChatLinkFilter,
  rewriteChatLinks,
  type ChatLinks,
} from '../../src/services/ai/chat-links';
import {buildMemoriesContext} from '../../src/module/api/ai/memory-context';

const LAGOS = '64b7f0c2a1b2c3d4e5f60711';
const PRIVATE = '64b7f0c2a1b2c3d4e5f60722';
const CHAT = '64b7f0c2a1b2c3d4e5f60733';
const OTHER = '64b7f0c2a1b2c3d4e5f60799';

const links: ChatLinks = {
  origin: 'https://mymemento.io',
  targets: new Map([
    [LAGOS, {type: 'story', shareable: true}],
    [PRIVATE, {type: 'story', shareable: false}],
    [CHAT, {type: 'conversation'}],
  ]),
};

/** Streams `text` in chunks of `size`, as the model would. */
function streamed(text: string, size: number): string {
  const filter = createChatLinkFilter(links);
  let out = '';
  for (let i = 0; i < text.length; i += size) {
    out += filter.push(text.slice(i, i + size));
  }
  return out + filter.flush();
}

describe('chat reply links', () => {
  it('keeps links to stories and conversations the reply was given', () => {
    const text = `See [Trip to Lagos](/stories/${LAGOS}) and [our chat](/chat/${CHAT}).`;
    expect(rewriteChatLinks(text, links)).toBe(text);
  });

  it('drops the link, not the words, for a story it was not given', () => {
    expect(
      rewriteChatLinks(`Read [Someone else](/stories/${OTHER}) now.`, links),
    ).toBe('Read Someone else now.');
  });

  it('keeps a story link pointing at the right kind of memory only', () => {
    expect(rewriteChatLinks(`[x](/chat/${LAGOS})`, links)).toBe('x');
  });

  it('turns absolute Memento story links into in-app links', () => {
    expect(
      rewriteChatLinks(
        `[Lagos](https://www.mymemento.io/stories/${LAGOS})`,
        links,
      ),
    ).toBe(`[Lagos](/stories/${LAGOS})`);
  });

  it('keeps share links only for stories visible to everyone', () => {
    expect(rewriteChatLinks(`https://mymemento.io/post/${LAGOS}.`, links)).toBe(
      `https://mymemento.io/post/${LAGOS}.`,
    );
    expect(
      rewriteChatLinks(`Here: https://mymemento.io/post/${PRIVATE}`, links),
    ).toBe('Here: ');
  });

  it('leaves other websites alone', () => {
    const text = 'Try [this](https://example.com/a) or https://example.com/b.';
    expect(rewriteChatLinks(text, links)).toBe(text);
  });

  it('gives the same result however the reply is split', () => {
    const text = `- [Trip to Lagos](/stories/${LAGOS})\n- [Fake](/stories/${OTHER})\nShare: https://mymemento.io/post/${LAGOS}\nAlso [sic] and h.`;
    const expected = rewriteChatLinks(text, links);
    for (const size of [1, 2, 3, 5, 8, 13, 400]) {
      expect(streamed(text, size)).toBe(expected);
    }
    expect(expected).toContain('- Fake');
  });

  it('does not hold back a stray bracket forever', () => {
    const filter = createChatLinkFilter(links);
    const out = filter.push(`[${'a'.repeat(700)}`);
    expect(out.length).toBeGreaterThan(600);
  });
});

describe('chat memory context links', () => {
  const memories = [
    {
      id: LAGOS,
      title: 'Trip to Lagos',
      summary: 'We landed at night.',
      topics: [],
      type: 'story',
      created_at: '2026-10-01T00:00:00.000Z',
      updated_at: '2026-10-01T00:00:00.000Z',
      visibility: 'everyone',
    },
    {
      id: PRIVATE,
      title: 'Diary',
      summary: 'Private thoughts.',
      topics: [],
      type: 'story',
      created_at: '2026-09-01T00:00:00.000Z',
      updated_at: '2026-09-01T00:00:00.000Z',
      visibility: 'private',
    },
  ];

  it('gives chat each story link and whether it can be shared', () => {
    const context = buildMemoriesContext(memories, {
      links: {origin: 'https://mymemento.io'},
    });
    expect(context).toContain(
      `[link: /stories/${LAGOS}] [share link: https://mymemento.io/post/${LAGOS}]`,
    );
    expect(context).toContain(
      `[link: /stories/${PRIVATE}] [private: no share link]`,
    );
  });

  it('keeps links out of contexts that did not ask for them, like voice', () => {
    expect(buildMemoriesContext(memories)).not.toContain('[link:');
  });
});
