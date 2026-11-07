import {describe, expect, it, vi} from 'vitest';

vi.mock('axios', () => ({
  default: {
    get: vi.fn(async () => ({
      headers: {'content-type': 'text/html'},
      request: {res: {responseUrl: 'https://example.com/post/1'}},
      data: `<html><head>
        <title>Post</title>
        <meta property="og:image" content="/images/cover.png">
        <link rel="shortcut icon" href="https://cdn.example.com/icon.ico">
      </head><body><article>Some words about the post.</article></body></html>`,
    })),
  },
}));

import {readLink} from '../../src/services/link-reader';

describe('readLink preview details', () => {
  it('resolves the preview image and icon against the page', async () => {
    const reading = await readLink('https://example.com/post/1');
    expect(reading).toMatchObject({
      kind: 'read',
      title: 'Post',
      image: 'https://example.com/images/cover.png',
      favicon: 'https://cdn.example.com/icon.ico',
    });
  });
});
