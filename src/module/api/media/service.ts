import {BACKEND_URL, BACKGROUND_MUSIC_BASE_URL} from '../../../utils/config';

// Bump when a file changes so clients and caches fetch the new audio.
const BACKGROUND_MUSIC_VERSION = 'v1';

// Keys match the values stored in user.bg_music.
const BACKGROUND_TRACKS = [
  {key: 'moonlight', title: 'Moonlight', file: 'moonlight.mp3'},
  {key: 'seawaves', title: 'Sea Waves', file: 'seawaves.mp3'},
  {key: 'arkansas', title: 'Arkansas', file: 'arkansas.mp3'},
  {key: 'love', title: 'A love for life', file: 'love.mp3'},
] as const;

export interface BackgroundTrack {
  key: string;
  title: string;
  url: string;
  version: string;
}

function backgroundMusicBase(): string {
  const base = BACKGROUND_MUSIC_BASE_URL || `${BACKEND_URL ?? ''}/assets/audio`;
  return base.replace(/\/$/, '');
}

export function listBackgroundMusic(): {
  message: string;
  data: BackgroundTrack[];
} {
  const base = backgroundMusicBase();
  return {
    message: 'Background music fetched successfully',
    data: BACKGROUND_TRACKS.map(({key, title, file}) => ({
      key,
      title,
      url: `${base}/${file}?v=${BACKGROUND_MUSIC_VERSION}`,
      version: BACKGROUND_MUSIC_VERSION,
    })),
  };
}
