import type {VOICE_SCREEN_DESTINATIONS} from '../live-session-config';

/**
 * What a server-run voice tool returns: the text Gemini hears, and effects
 * for the app to apply. The app applies only the effect types it knows, so
 * keep to these when adding tools; a new type needs an app release.
 */
export type VoiceToolEffect =
  | {
      type: 'refresh';
      what:
        | 'profile'
        | 'memories'
        | 'capsules'
        | 'beneficiaries'
        | 'observations';
    }
  | {type: 'open'; destination: (typeof VOICE_SCREEN_DESTINATIONS)[number]}
  | {type: 'open_story'; id: string};

export type VoiceToolOutcome = {
  result: string;
  effects: VoiceToolEffect[];
  /** Set when nothing happened yet: what to confirm, and the code that runs it. */
  confirm?: {readBack: string; code: string};
  /** What was done, in a few words, when something was. */
  summary?: string;
};

/** How to reverse something Memento did by voice ("undo that"). */
export type VoiceUndo =
  | {
      kind: 'profile';
      fields: Record<string, unknown>;
      /** What the action set, so undo can tell the host changed it since. */
      expect?: Record<string, unknown>;
    }
  | {
      kind: 'story_fields';
      id: string;
      title?: string;
      tags?: string[];
      body?: string;
      expectTitle?: string;
      expectTags?: string[];
      expectBody?: string;
    }
  | {
      kind: 'story_access';
      id: string;
      groups: string[];
      beneficiaries: string[];
      visibility: 'private' | 'everyone';
      /** What the action set, so undo can tell the host changed it since. */
      expect: {
        groups: string[];
        beneficiaries: string[];
        visibility: 'private' | 'everyone';
      };
    }
  | {
      kind: 'observation_text';
      id: string;
      heading: string;
      note: string;
      expectHeading: string;
      expectNote: string;
    }
  | {kind: 'bookmark'; id: string; on: boolean}
  | {kind: 'remove_story'; id: string}
  | {kind: 'forget_observation'; id: string}
  | {kind: 'restore_story'; id: string}
  | {kind: 'remove_capsule'; id: string}
  | {
      kind: 'unschedule_capsule';
      id: string;
      status: string;
      schedule_date?: string;
    }
  | {kind: 'remove_beneficiary'; id: string; email: string};

/**
 * What a handler returns: the outcome, plus how to undo it and a short
 * summary for the action log. Only the outcome reaches the app.
 */
export type VoiceToolRun = VoiceToolOutcome & {
  undo?: VoiceUndo;
  summary?: string;
};
