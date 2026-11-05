import Persona from '../../module/database/model/persona';
import {observationHash} from '../../utils/observation-id';

/** Drops anything the member told Memento to forget from a new extraction. */
export async function filterForgottenInsights(
  userId: string,
  insights: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const persona = await Persona.findOne({user: userId})
    .select('+forgotten_observations')
    .lean();
  const forgotten = new Set(persona?.forgotten_observations ?? []);
  if (!forgotten.size) return insights;

  return Object.fromEntries(
    Object.entries(insights).map(([field, items]) => [
      field,
      Array.isArray(items)
        ? items.filter(
            item =>
              typeof item !== 'string' ||
              !forgotten.has(observationHash(field, item)),
          )
        : items,
    ]),
  );
}
