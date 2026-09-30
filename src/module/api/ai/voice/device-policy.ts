import {VOICE_SPEAKER_DUPLEX_DENYLIST} from '../../../../utils/config';

/**
 * Whether the app may stream the mic while the model talks on the
 * loudspeaker. Models with poor built-in echo cancellation are denylisted
 * by exact name or prefix, case-insensitive, via VOICE_SPEAKER_DUPLEX_DENYLIST.
 */
export function allowsSpeakerFullDuplex(
  deviceModel: string | undefined,
  denylist: readonly string[] = VOICE_SPEAKER_DUPLEX_DENYLIST,
): boolean {
  const model = deviceModel?.trim().toLowerCase();
  if (!model) return true;
  return !denylist.some(entry => model === entry || model.startsWith(entry));
}
