import Message from '../../../database/model/message';

const LEGACY_TRANSCRIPT_MARKER = '--- Transcript ---';
const MAX_LINE_CHARS = 600;

export type TranscriptLine = {speaker: 'Host' | 'Memento'; text: string};

function clip(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > MAX_LINE_CHARS
    ? `${normalized.slice(0, MAX_LINE_CHARS)}…`
    : normalized;
}

function expandLegacyVoiceBlob(text: string): TranscriptLine[] {
  const markerAt = text.indexOf(LEGACY_TRANSCRIPT_MARKER);
  if (markerAt === -1) return [];
  const lines: TranscriptLine[] = [];
  for (const raw of text
    .slice(markerAt + LEGACY_TRANSCRIPT_MARKER.length)
    .split('\n')) {
    const match = /^(You|Memento):\s*(.*)$/.exec(raw.trim());
    if (!match || !match[2].trim()) continue;
    lines.push({
      speaker: match[1] === 'You' ? 'Host' : 'Memento',
      text: clip(match[2]),
    });
  }
  return lines;
}

export async function getRecentConversationLines(
  userId: string,
  memoryId: string,
  maxLines = 20,
): Promise<TranscriptLine[]> {
  const rows = await Message.find({user: userId, memory: memoryId})
    .sort({created_at: -1})
    .limit(maxLines)
    .select('role text is_voice')
    .lean();

  const lines: TranscriptLine[] = [];
  for (const row of rows.reverse()) {
    const text = String(row.text || '');
    if (
      row.is_voice &&
      row.role === 'ai' &&
      text.includes(LEGACY_TRANSCRIPT_MARKER)
    ) {
      lines.push(...expandLegacyVoiceBlob(text));
      continue;
    }
    if (!text.trim()) continue;
    lines.push({
      speaker: row.role === 'user' ? 'Host' : 'Memento',
      text: clip(text),
    });
  }
  return lines.slice(-maxLines);
}

export function formatTranscriptLines(lines: TranscriptLine[]): string {
  return lines.map(line => `${line.speaker}: ${line.text}`).join('\n');
}
