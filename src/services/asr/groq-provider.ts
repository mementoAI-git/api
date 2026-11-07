import {GROQ_API_KEY, GROQ_BASE_URL} from '../../utils/config';
import {uploadMimeBaseType} from '../../utils/helpers';
import {
  AsrProvider,
  AsrTranscriptionInput,
  AsrTranscriptionResult,
} from './types';

const MODEL = 'whisper-large-v3-turbo';
const TIMEOUT_MS = 25_000;
/** Whisper can invent words for silence; it reports how likely a segment was just that. */
const NO_SPEECH_LIMIT = 0.6;

const EXTENSIONS: Record<string, string> = {
  'audio/mp4': 'm4a',
  'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/flac': 'flac',
  'audio/webm': 'webm',
  'video/webm': 'webm',
};

interface WhisperSegment {
  text: string;
  start: number;
  end: number;
  no_speech_prob?: number;
}

/** Keeps transcription working when Gemini is out of quota or unavailable. */
export class GroqAsrProvider implements AsrProvider {
  readonly providerId = 'groq';

  isConfigured() {
    return Boolean(GROQ_API_KEY);
  }

  async transcribe(
    input: AsrTranscriptionInput,
  ): Promise<AsrTranscriptionResult> {
    const part = input.processedFilePart as {
      inlineData?: {mimeType?: string; data?: string};
    };
    const inline = part?.inlineData;
    if (!inline?.data) {
      throw new Error('Groq transcription needs inline audio.');
    }
    const mimeType = uploadMimeBaseType(inline.mimeType || 'audio/webm');
    const form = new FormData();
    form.append(
      'file',
      new Blob([Buffer.from(inline.data, 'base64')], {type: mimeType}),
      `audio.${EXTENSIONS[mimeType] ?? 'webm'}`,
    );
    form.append('model', MODEL);
    form.append('response_format', 'verbose_json');

    const baseUrl = (GROQ_BASE_URL || 'https://api.groq.com/openai/v1').replace(
      /\/$/,
      '',
    );
    const response = await fetch(`${baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: {Authorization: `Bearer ${GROQ_API_KEY}`},
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      throw Object.assign(new Error('Groq transcription failed'), {
        status: response.status,
      });
    }
    const result = (await response.json()) as {
      text?: string;
      segments?: WhisperSegment[];
    };
    const spoken = (result.segments ?? []).filter(
      segment => (segment.no_speech_prob ?? 0) < NO_SPEECH_LIMIT,
    );
    const segments = spoken.map(segment => ({
      text: segment.text.trim(),
      start: segment.start,
      end: segment.end,
    }));
    return {
      data: {
        full_text: result.segments
          ? segments.map(segment => segment.text).join(' ')
          : (result.text ?? '').trim(),
        segments,
      },
      provider: this.providerId,
      model: MODEL,
    };
  }
}
