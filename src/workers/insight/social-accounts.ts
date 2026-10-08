import Persona from '../../module/database/model/persona';
import {confirmedSocialCandidates} from '../../utils/social-accounts';

export async function saveConfirmedSocialAccounts(
  userId: string,
  sourceId: string,
  candidates: unknown,
  userContent: string,
): Promise<void> {
  const accounts = confirmedSocialCandidates(candidates, userContent);
  if (!accounts.length) return;
  await Persona.updateOne(
    {user: userId},
    {$setOnInsert: {user: userId}},
    {upsert: true},
  );
  for (const account of accounts) {
    const path = `social_accounts.${account.platform}`;
    // Atomic: never replace an existing account or a user's explicit removal marker.
    await Persona.updateOne(
      {user: userId, [path]: {$exists: false}},
      {
        $set: {
          [path]: {
            url: account.url,
            source: 'ai',
            confirmed_at: new Date(),
            evidence: account.evidence,
            source_id: sourceId,
          },
        },
      },
    );
  }
}
