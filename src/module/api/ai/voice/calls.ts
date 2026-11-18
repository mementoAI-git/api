import {recordEndedVoiceCall} from '../../billing/voice-allowance';
import {z} from 'zod';
import Memory from '../../../database/model/memory';
import Message from '../../../database/model/message';
import File from '../../../database/model/file';
import VoiceCall, {IVoiceCallSummary} from '../../../database/model/voice-call';
import {assertOwnedMemory} from '../../memory/access';
import {createMemory} from '../../memory/service';
import {extractJson} from '../../../../utils/helpers';
import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '../../../../utils/service-error';
import {generateVoiceJson} from './text-generator';
import {
  cleanVoiceCallTranscript,
  ensureVoiceCallCleaned,
  formatTranscriptLines,
  loadCallTurns,
  UNCLEAR_MARKER,
} from './transcript-cleanup';
import type {VoiceCallRecordingBody} from '../dto';

export const VOICE_SUMMARY_PROMPT_VERSION = 'voice-summary-v1';

export type EndVoiceCallPayload = {
  memory_id?: string;
  duration_seconds: number;
};

async function resolveCallMemoryId(
  userId: string,
  sessionId: string,
  memoryId?: string,
): Promise<string | undefined> {
  if (memoryId) {
    const memory = await assertOwnedMemory(memoryId, userId);
    return String(memory._id);
  }
  const bySession = await Memory.findOne({user: userId, session_id: sessionId})
    .select('_id')
    .lean();
  if (bySession) return String(bySession._id);
  const anyTurn = await Message.findOne({
    user: userId,
    voice_session_id: sessionId,
  })
    .select('memory')
    .lean();
  return anyTurn?.memory ? String(anyTurn.memory) : undefined;
}

/**
 * Records that a voice call ended: saves the real duration on the call and
 * its messages, then starts transcript clean-up in the background.
 */
export async function endVoiceCall(
  userId: string,
  sessionId: string,
  payload: EndVoiceCallPayload,
) {
  const memoryId = await resolveCallMemoryId(
    userId,
    sessionId,
    payload.memory_id,
  );
  const hasTurns = Boolean(
    await Message.exists({user: userId, voice_session_id: sessionId}),
  );
  const duration = Math.round(payload.duration_seconds);
  await recordEndedVoiceCall(userId, payload.duration_seconds);

  const call = await VoiceCall.findOneAndUpdate(
    {user: userId, session_id: sessionId},
    {
      $set: {
        memory: memoryId,
        duration_seconds: duration,
        ended_at: new Date(),
      },
      $setOnInsert: {
        cleanup_status: hasTurns ? 'pending' : 'skipped',
        queue_insights: hasTurns,
      },
    },
    {upsert: true, new: true},
  ).lean();

  if (memoryId) {
    await Message.updateMany(
      {memory: memoryId, voice_session_id: sessionId},
      {$set: {duration}},
    );
  }

  if (call?.cleanup_status === 'pending') {
    setImmediate(() => {
      void cleanVoiceCallTranscript(userId, sessionId).catch(error =>
        console.error('Voice transcript clean-up crashed', error),
      );
    });
  }

  return {
    message: 'Voice call ended',
    data: {
      session_id: sessionId,
      memory_id: memoryId ?? null,
      duration_seconds: duration,
      cleanup_status: call?.cleanup_status ?? 'pending',
    },
  };
}

const summaryOutputSchema = z.object({
  summary: z.string().trim().min(1).max(1_500),
  key_points: z
    .array(z.string().trim().min(1).max(200))
    .max(8)
    .default([])
    .transform(points => points.slice(0, 4)),
});

export function buildSummaryPrompt(transcript: string): string {
  return `Summarize this voice call between the Host and Memento, an AI companion that helps them capture their life stories. Write to the Host in the second person ("You talked about...").

- "summary": 2 to 4 warm, plain sentences about what the Host shared. Focus on their stories, people, places and feelings, not on Memento.
- "key_points": up to 4 short phrases naming specific things worth remembering. Use an empty list if the call was only small talk.

Ignore lines marked ${UNCLEAR_MARKER}. Do not invent details that are not in the transcript.

Return JSON only, in this shape: {"summary":"...","key_points":["..."]}

Transcript:
${transcript}`;
}

export function parseSummaryResponse(raw: string) {
  const result = summaryOutputSchema.safeParse(extractJson(raw));
  return result.success ? result.data : null;
}

function presentSummary(summary: IVoiceCallSummary) {
  return {
    text: summary.text,
    key_points: summary.key_points ?? [],
    generated_at: summary.generated_at,
  };
}

/**
 * Returns the saved summary of a voice call, generating and saving it on
 * first request. Calls recorded before call records existed get one here.
 */
export async function getVoiceCallSummary(userId: string, sessionId: string) {
  const call = await VoiceCall.findOne({user: userId, session_id: sessionId});
  if (call?.summary?.text) {
    return {
      message: 'Voice call summary',
      data: {summary: presentSummary(call.summary)},
    };
  }

  if (!call) {
    const anyTurn = await Message.findOne({
      user: userId,
      voice_session_id: sessionId,
    })
      .select('memory')
      .lean();
    if (!anyTurn) throw new NotFoundException('Voice call not found');
    await VoiceCall.findOneAndUpdate(
      {user: userId, session_id: sessionId},
      {
        $setOnInsert: {
          memory: String(anyTurn.memory),
          cleanup_status: 'pending',
          queue_insights: false,
        },
      },
      {upsert: true, new: true},
    );
  }

  await ensureVoiceCallCleaned(userId, sessionId);
  const turns = await loadCallTurns(userId, sessionId);
  if (turns.length === 0) throw new NotFoundException('Voice call not found');

  let raw: string;
  try {
    raw = await generateVoiceJson(
      'voice_call_summary',
      buildSummaryPrompt(formatTranscriptLines(turns)),
      userId,
      {accept: answer => parseSummaryResponse(answer) !== null},
    );
  } catch {
    throw new ServiceUnavailableException(
      'Could not summarize this call. Try again.',
    );
  }
  const parsed = parseSummaryResponse(raw);
  if (!parsed) {
    throw new ServiceUnavailableException(
      'Could not summarize this call. Try again.',
    );
  }

  const summary: IVoiceCallSummary = {
    text: parsed.summary,
    key_points: parsed.key_points,
    generated_at: new Date(),
    prompt_version: VOICE_SUMMARY_PROMPT_VERSION,
  };
  await VoiceCall.updateOne(
    {user: userId, session_id: sessionId},
    {$set: {summary}},
  );
  return {
    message: 'Voice call summary',
    data: {summary: presentSummary(summary)},
  };
}

/** Shown in a call's story when only the transcript could be kept. */
const AUDIO_OMITTED_NOTES: Record<
  NonNullable<VoiceCallRecordingBody['audio_omitted']>,
  string
> = {
  too_large:
    'The audio of this call was too large to keep, so only the transcript was saved.',
  storage_full:
    'Your storage was full, so only the transcript of this call was saved.',
  upload_failed:
    'The audio of this call could not be uploaded, so only the transcript was saved.',
};

/** Escape the five special HTML characters. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Formats a date as "Nov 11, 2026" using the UTC wall-clock value so the
 * title is stable regardless of where the server runs.
 */
function formatCallDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * Saves the uploaded recording for a voice call and creates a Story from the
 * transcript. Idempotent: a second call for the same session returns the
 * previously created story without making any changes.
 */
export async function saveVoiceCallRecording(
  userId: string,
  sessionId: string,
  payload: VoiceCallRecordingBody,
) {
  // The web app reports a call's length here rather than at /end.
  await recordEndedVoiceCall(userId, payload.duration_seconds);
  // Idempotency check: if a story was already created for this session, return
  // the existing ids without touching anything.
  const existingCall = await VoiceCall.findOne({
    user: userId,
    session_id: sessionId,
  })
    .select('story_memory recording_file')
    .lean();

  if (existingCall?.story_memory) {
    return {
      message: 'Voice call recording saved',
      data: {
        memory_id: String(existingCall.story_memory),
        file_id: existingCall.recording_file
          ? String(existingCall.recording_file)
          : null,
      },
    };
  }

  // Without audio the transcript is all there is, so it must have words.
  const fileId = payload.file_id ?? null;
  if (!fileId && !payload.segments.some(seg => seg.text.trim())) {
    throw new BadRequestException('Nothing to save: no audio or transcript');
  }

  if (fileId) {
    // Verify the file exists, belongs to the user, and is an audio file.
    const file = await File.findOne({
      _id: fileId,
      user: userId,
      deleted: {$ne: true},
    })
      .select('_id type')
      .lean();

    if (!file) {
      throw new NotFoundException('File not found');
    }
    if (!String(file.type).startsWith('audio/')) {
      throw new BadRequestException('File must be an audio file');
    }
  }

  // Build transcript: full_text as labelled lines, HTML body as paragraphs.
  const lines: string[] = [];
  const htmlParagraphs: string[] = [];

  for (const seg of payload.segments) {
    const label = seg.speaker === 'ai' ? 'Memento' : 'You';
    const safeText = escapeHtml(seg.text);
    lines.push(`${label}: ${seg.text}`);
    htmlParagraphs.push(`<p><strong>${label}</strong> ${safeText}</p>`);
  }

  const fullText = lines.join('\n');
  if (payload.audio_omitted) {
    htmlParagraphs.push(
      `<p><em>${AUDIO_OMITTED_NOTES[payload.audio_omitted]}</em></p>`,
    );
  }
  const htmlBody = htmlParagraphs.join('\n');

  // Write transcription + duration onto the File document.
  if (fileId)
    await File.updateOne(
      {_id: fileId},
      {
        $set: {
          duration: payload.duration_seconds,
          transcription: {
            full_text: fullText,
            segments: payload.segments,
            ...(payload.speech?.length ? {speech: payload.speech} : {}),
          },
        },
      },
    );

  const dateLabel = formatCallDate(new Date());
  const title = `Conversation with Memento · ${dateLabel}`;

  // Create the Story memory using the existing service so all side effects
  // (streak, search indexing, enrichment cache bust) run as normal.
  // We skip insights because the call's turns already feed that pipeline.
  const {data: memory} = await createMemory(
    {
      title,
      body: htmlBody,
      status: 'save',
      capture_source: 'voice_call',
      tags: [],
      level: 1,
      attachments: fileId ? [fileId] : [],
    },
    userId,
    null,
    undefined,
    {skipInsights: true},
  );

  // Upsert the VoiceCall record so a recording that arrives before /end still
  // creates a coherent record.
  await VoiceCall.findOneAndUpdate(
    {user: userId, session_id: sessionId},
    {
      $set: {
        ...(fileId ? {recording_file: fileId} : {}),
        story_memory: String(memory._id),
      },
      $setOnInsert: {
        cleanup_status: 'skipped',
        queue_insights: false,
        duration_seconds: payload.duration_seconds,
      },
    },
    {upsert: true},
  );

  return {
    message: 'Voice call recording saved',
    data: {
      memory_id: String(memory._id),
      file_id: fileId,
    },
  };
}
