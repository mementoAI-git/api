import type {VOICE_SCREEN_DESTINATIONS} from '../live-session-config';

/**
 * What a server-run voice tool returns: the text Gemini hears, and effects
 * for the app to apply. The app applies only the effect types it knows, so
 * keep to these when adding tools; a new type needs an app release.
 */
export type VoiceToolEffect =
  | {
      type: 'refresh';
      what: 'profile' | 'memories' | 'capsules' | 'beneficiaries';
    }
  | {type: 'open'; destination: (typeof VOICE_SCREEN_DESTINATIONS)[number]}
  | {type: 'open_story'; id: string};

export type VoiceToolOutcome = {result: string; effects: VoiceToolEffect[]};
