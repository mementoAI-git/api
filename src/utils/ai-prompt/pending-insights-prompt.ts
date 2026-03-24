import PendingInsight from '../../module/database/model/pending-insight';
import { PERSONA_INSIGHT_FIELDS } from '../constant';

const FIELD_LABELS: Record<(typeof PERSONA_INSIGHT_FIELDS)[number], string> = {
  important_notes: 'Important notes',
  key_preferences: 'Key preferences',
  emotional_state_trends: 'Emotional trends',
  goals_and_aspirations: 'Goals and aspirations',
};

const PENDING_CONTEXT_LIMIT = 20;

export async function buildPendingInsightsPromptSection(userId: string): Promise<string> {
  const rows = await PendingInsight.find({ user: userId })
    .sort({ created_at: 1 })
    .limit(PENDING_CONTEXT_LIMIT)
    .select('field content')
    .lean();

  if (!rows.length) return '';

  // Group by field
  const byField: Partial<Record<(typeof PERSONA_INSIGHT_FIELDS)[number], string[]>> = {};
  for (const row of rows) {
    const field = row.field as (typeof PERSONA_INSIGHT_FIELDS)[number];
    if (!byField[field]) byField[field] = [];
    byField[field].push(row.content);
  }

  const lines: string[] = [];
  for (const field of PERSONA_INSIGHT_FIELDS) {
    const items = byField[field];
    if (!items?.length) continue;
    lines.push(`\n${FIELD_LABELS[field]}:`);
    for (const item of items) {
      lines.push(`- ${item}`);
    }
  }

  if (!lines.length) return '';

  return `

RECENTLY INFERRED CONTEXT (use naturally; weave in when relevant):
${lines.join('\n').trim()}`;
}
