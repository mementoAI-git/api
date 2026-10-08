import {BadRequestException} from '../../../utils/service-error';

export type TranscriptionInput =
  | {kind: 'stored'; fileId: string}
  | {kind: 'recording'; file: Express.Multer.File; mimeType: string};

/** Dictation audio is held in request memory only; it is never persisted as a file. */
export function getTranscriptionInput(
  body: {file_id?: unknown} = {},
  file?: Express.Multer.File,
): TranscriptionInput {
  if (file) {
    if (body.file_id !== undefined) {
      throw new BadRequestException(
        'Send either a recording or file_id, not both.',
      );
    }
    const mimeType = file.mimetype.split(';')[0].trim().toLowerCase();
    const allowed = new Set([
      'audio/webm',
      'video/webm',
      'audio/mp4',
      'audio/mpeg',
      'audio/mp3',
      'audio/wav',
      'audio/x-wav',
      'audio/ogg',
      'audio/aac',
      'audio/flac',
    ]);
    if (!allowed.has(mimeType)) {
      throw new BadRequestException('An audio recording is required.');
    }
    if (!file.buffer.length) {
      throw new BadRequestException('The recording is empty.');
    }
    if (file.buffer.length > 15 * 1024 * 1024) {
      throw new BadRequestException(
        'The recording must be no larger than 15 MB.',
      );
    }
    return {kind: 'recording', file, mimeType};
  }
  if (!body.file_id) {
    throw new BadRequestException('A recording or file_id is required.');
  }
  if (
    typeof body.file_id !== 'string' ||
    !/^[a-f\d]{24}$/i.test(body.file_id)
  ) {
    throw new BadRequestException('Invalid file_id.');
  }
  return {kind: 'stored', fileId: body.file_id};
}
