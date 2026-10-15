import {ServiceError} from '../../../../utils/service-error';
import logger from '../../../../utils/logger';
import type {VoiceToolOutcome} from './server-tool-types';

/**
 * A service refusal as something Memento can say kindly. Limits and plans
 * get a plain explanation instead of the raw message; unexpected errors
 * never reach the host's ears.
 */
export function failed(error: unknown, tool?: string): VoiceToolOutcome {
  const say = (what: string): VoiceToolOutcome => ({
    result: `That did not work: ${what} Tell the host plainly, in a few words.`,
    effects: [],
  });
  if (error instanceof ServiceError) {
    if (error.code === 'storage_quota_exceeded' || error.statusCode === 507) {
      return say(
        'their Memento storage is full. They can free some space or get more in the app.',
      );
    }
    switch (error.statusCode) {
      case 402:
        return say(
          'that needs Memento Pro, or they have reached their plan limit for it. They can see their plan in the app; never offer to upgrade or pay for them.',
        );
      case 403:
        return say('their account is not allowed to do that.');
      case 404:
        return say(
          'it could not be found; it may have been deleted or moved. Ask what they meant.',
        );
      case 409:
        return say(
          `it clashes with something already there (${error.message}).`,
        );
      case 429:
        return say(
          'too many changes too quickly. Offer to try again in a moment.',
        );
      default:
        if (error.statusCode >= 400 && error.statusCode < 500) {
          return say(`${error.message}. Suggest doing it in the app.`);
        }
    }
  }
  logger.warn({err: error, tool}, 'Voice tool failed');
  return say(
    "something went wrong on Memento's side. Suggest trying again shortly or doing it in the app.",
  );
}
