import {describe, expect, test, vi} from 'vitest';

const config = vi.hoisted(() => ({
  BACKEND_URL: 'https://api.test' as string | undefined,
  BACKGROUND_MUSIC_BASE_URL: undefined as string | undefined,
}));
vi.mock('../../src/utils/config', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/utils/config')>()),
  get BACKEND_URL() {
    return config.BACKEND_URL;
  },
  get BACKGROUND_MUSIC_BASE_URL() {
    return config.BACKGROUND_MUSIC_BASE_URL;
  },
}));

import {listBackgroundMusic} from '../../src/module/api/media/service';

describe('background music catalog', () => {
  test('lists every track with a versioned URL served by the API', () => {
    config.BACKGROUND_MUSIC_BASE_URL = undefined;
    const {data} = listBackgroundMusic();
    expect(data.map(track => track.key)).toEqual([
      'moonlight',
      'seawaves',
      'arkansas',
      'love',
    ]);
    expect(data[0]).toEqual({
      key: 'moonlight',
      title: 'Moonlight',
      url: 'https://api.test/assets/audio/moonlight.mp3?v=v1',
      version: 'v1',
    });
  });

  test('uses a configured CDN base instead of the API host', () => {
    config.BACKGROUND_MUSIC_BASE_URL = 'https://cdn.test/music/';
    expect(listBackgroundMusic().data[1].url).toBe(
      'https://cdn.test/music/seawaves.mp3?v=v1',
    );
  });
});
