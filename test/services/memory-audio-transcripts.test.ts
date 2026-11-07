import {Types} from 'mongoose';
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
import File from '../../src/module/database/model/file';
import {
  memoryHasVoiceRecording,
  transcribeMemoryAudio,
} from '../../src/services/memory-audio-transcripts';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';

const userId = new Types.ObjectId().toString();

async function createFile(type: string, user = userId) {
  const file = await File.create({
    name: `file-${new Types.ObjectId()}`,
    type,
    size: 10,
    user,
    provider: 's3',
  });
  return file.id as string;
}

describe('memory audio transcripts', () => {
  beforeAll(connectTestDatabase);
  afterEach(clearTestDatabase);
  afterAll(closeTestDatabase);

  it('transcribes recordings and ignores other attachments', async () => {
    const voice = await createFile('audio/mp4');
    const webm = await createFile('video/webm');
    const photo = await createFile('image/png');
    const transcribe = vi.fn(async ({fileId}: {fileId: string}) => ({
      data: {full_text: fileId === voice ? ' Hello there. ' : 'Second clip.'},
    }));
    const result = await transcribeMemoryAudio(
      userId,
      [voice, webm, photo],
      transcribe,
    );
    expect(transcribe).toHaveBeenCalledTimes(2);
    expect(result.recordings).toBe(2);
    expect(result.text).toContain('Hello there.');
    expect(result.text).toContain('Second clip.');
  });

  it("never touches another member's file", async () => {
    const theirs = await createFile(
      'audio/mp4',
      new Types.ObjectId().toString(),
    );
    const transcribe = vi.fn();
    const result = await transcribeMemoryAudio(userId, [theirs], transcribe);
    expect(transcribe).not.toHaveBeenCalled();
    expect(result).toEqual({text: '', recordings: 0});
  });

  it('still reports the recording when transcription fails', async () => {
    const voice = await createFile('audio/webm');
    const transcribe = vi.fn().mockRejectedValue(new Error('AI down'));
    await expect(
      transcribeMemoryAudio(userId, [voice], transcribe),
    ).resolves.toEqual({text: '', recordings: 1});
  });

  it('accepts populated attachments and detects recordings', async () => {
    const voice = await createFile('audio/mp4');
    const photo = await createFile('image/png');
    expect(await memoryHasVoiceRecording(userId, [{_id: voice}])).toBe(true);
    expect(await memoryHasVoiceRecording(userId, [photo])).toBe(false);
    expect(await memoryHasVoiceRecording(userId, [])).toBe(false);
  });
});
