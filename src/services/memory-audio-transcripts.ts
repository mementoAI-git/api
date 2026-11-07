import File from '../module/database/model/file';
import {logger} from '../utils';

const VOICE_TYPE = /^(audio\/|video\/webm)/i;

function idsOf(attachments: unknown[] = []): string[] {
  return attachments.map(attachment =>
    typeof attachment === 'object' && attachment && '_id' in attachment
      ? String((attachment as {_id: unknown})._id)
      : String(attachment),
  );
}

async function loadVoiceFiles(userId: string, attachments: unknown[] = []) {
  const ids = idsOf(attachments);
  if (!ids.length) return [];
  const files = await File.find({_id: {$in: ids}, user: userId})
    .select('_id type')
    .lean();
  return files.filter(file => VOICE_TYPE.test(file.type || ''));
}

export async function memoryHasVoiceRecording(
  userId: string,
  attachments: unknown[] = [],
): Promise<boolean> {
  return (await loadVoiceFiles(userId, attachments)).length > 0;
}

type Transcribe = (input: {
  kind: 'stored';
  fileId: string;
}) => Promise<{data?: {full_text?: string} | null}>;

/**
 * Gives a story's recordings a transcript for Memento's own use. The recording stays what
 * the member sees and hears: the text lives on the file, never in the story's body, and is
 * cached there, so running this again costs nothing.
 */
export async function transcribeMemoryAudio(
  userId: string,
  attachments: unknown[] = [],
  transcribe?: Transcribe,
): Promise<{text: string; recordings: number}> {
  const files = await loadVoiceFiles(userId, attachments);
  if (!files.length) return {text: '', recordings: 0};
  // Loaded on demand so saving a story without audio never pulls in the AI service.
  const run =
    transcribe ?? (await import('../module/api/ai/service')).transcribeAudio;
  const spoken: string[] = [];
  for (const file of files) {
    try {
      const result = await run({kind: 'stored', fileId: String(file._id)});
      const text = result?.data?.full_text?.trim();
      if (text) spoken.push(text);
    } catch (error) {
      // A failed transcript must never cost the member their saved recording.
      logger.warn(
        {fileId: String(file._id), error},
        'Voice recording could not be transcribed',
      );
    }
  }
  return {text: spoken.join('\n\n'), recordings: files.length};
}
