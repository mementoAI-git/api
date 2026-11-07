import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  clearLinkPreviewCache,
  previewFromReading,
  previewLink,
} from '../../src/services/link-preview';

describe('link previews', () => {
  afterEach(() => clearLinkPreviewCache());

  it('passes on the page title, image and icon', () => {
    expect(
      previewFromReading('https://www.0xgroot.xyz', {
        kind: 'read',
        url: 'https://www.0xgroot.xyz/',
        title: 'Groot',
        description: '',
        text: 'Hello',
        image: 'https://www.0xgroot.xyz/og.png',
        favicon: 'https://www.0xgroot.xyz/icon.svg',
      }),
    ).toEqual({
      url: 'https://www.0xgroot.xyz',
      domain: '0xgroot.xyz',
      title: 'Groot',
      image: 'https://www.0xgroot.xyz/og.png',
      favicon: 'https://www.0xgroot.xyz/icon.svg',
    });
  });

  it('gives only the site for pages it cannot read', () => {
    expect(
      previewFromReading('https://linkedin.com/posts/x', {
        kind: 'login_walled',
        url: 'https://linkedin.com/posts/x',
        site: 'linkedin.com',
      }),
    ).toEqual({url: 'https://linkedin.com/posts/x', domain: 'linkedin.com'});
  });

  it('reads each link once while cached', async () => {
    const read = vi.fn(async (url: string) => ({
      kind: 'unreadable' as const,
      url,
      reason: 'test',
    }));
    await previewLink('https://example.com', read, 1_000);
    await previewLink('https://example.com', read, 2_000);
    expect(read).toHaveBeenCalledTimes(1);
  });
});
