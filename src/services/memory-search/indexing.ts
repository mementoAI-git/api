import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import type {Readable} from 'node:stream';
import sharp from 'sharp';
import Memory, {
  type IMemorySearchIndex,
} from '../../module/database/model/memory';
import {getFile} from '../storage';
import {isActiveAccount} from '../account-purge/account-state';
import {searchPilotEnabled} from './config';
import {loadChatSources} from './chats';
import {embedInputs, type EmbeddingInput} from './engine';
import {loadSearchPhotos, ownerSearchScope} from './load';
import {
  fingerprint,
  idOf,
  photosFor,
  textChunks,
  VECTOR_VERSION,
  MAX_PILOT_MEMORIES,
  isCoolingDown,
  type SearchPhoto,
} from './source';

const MAX_PHOTO_BYTES = 20 * 1024 * 1024;

async function stagePhoto(photo: SearchPhoto, target: string) {
  if (!photo.size || photo.size > MAX_PHOTO_BYTES)
    throw new Error('Photo exceeds description search limits');
  const response = await getFile(
    photo.name,
    undefined,
    photo.provider as 's3' | 'gcs' | 'cloudinary',
    photo.type,
  );
  const stream = response.Body as Readable;
  if (!stream) throw new Error('Photo content is unavailable');
  const timer = setTimeout(
    () => stream.destroy(new Error('Photo read timed out')),
    30_000,
  );
  try {
    if (response.ContentLength > MAX_PHOTO_BYTES)
      throw new Error('Photo exceeds description search limits');
    const pieces: Buffer[] = [];
    let bytes = 0;
    for await (const piece of stream) {
      const buffer = Buffer.isBuffer(piece) ? piece : Buffer.from(piece);
      bytes += buffer.length;
      if (bytes > MAX_PHOTO_BYTES)
        throw new Error('Photo exceeds description search limits');
      pieces.push(buffer);
    }
    const png = await sharp(Buffer.concat(pieces), {
      limitInputPixels: 40_000_000,
    })
      .rotate()
      .resize({
        width: 1024,
        height: 1024,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .png()
      .toBuffer();
    await writeFile(target, png, {mode: 0o600});
  } finally {
    clearTimeout(timer);
    stream.destroy();
  }
}

/** Worker-only: reload source, prepare privately, and publish only if the source is still current. */
export async function indexMemory(
  userId: string,
  memoryId: string,
): Promise<boolean> {
  if (!searchPilotEnabled(userId) || !(await isActiveAccount(userId)))
    return false;
  if (
    (await Memory.countDocuments(ownerSearchScope(userId)).limit(
      MAX_PILOT_MEMORIES + 1,
    )) > MAX_PILOT_MEMORIES
  )
    return false;
  const scope = {
    _id: memoryId,
    user: userId,
    type: {$in: ['story', 'conversation']},
    status: {$nin: ['draft', 'deleted']},
  };
  const saved = await Memory.findOne(scope).select('+search_index').lean();
  if (!saved) return false;
  const [source] = await loadChatSources(userId, [saved]);
  const files = await loadSearchPhotos(userId, [source]);
  if (isCoolingDown(source, files)) return false;
  const initialFingerprint = fingerprint(source, files);
  const workspace = await mkdtemp(path.join(tmpdir(), 'memento-photo-search-'));
  try {
    if (source.type === 'conversation' && !source.chat_source?.complete)
      throw new Error('Conversation exceeds description-search limits');
    const text = textChunks(
      source.title,
      [source.body, source.chat_source?.text].filter(Boolean).join('\n'),
    );
    const photos = photosFor(source, files);
    if (photos.length > 5)
      throw new Error('Too many photos for the description search pilot');
    const batches: EmbeddingInput[] = [];
    for (let i = 0; i < text.length; i += 16)
      batches.push({op: 'text', inputs: text.slice(i, i + 16)});
    for (const photo of photos) {
      const target = path.join(workspace, `${idOf(photo)}.png`);
      await stagePhoto(photo, target);
      batches.push({op: 'image', inputs: [target]});
    }
    const vectors = batches.length ? await embedInputs(batches) : [];
    const chunks: IMemorySearchIndex['chunks'] = [];
    let photoIndex = 0;
    for (let i = 0; i < batches.length; i++) {
      for (const vector of vectors[i]) {
        chunks.push(
          batches[i].op === 'text'
            ? {kind: 'story', vector}
            : {kind: 'photo', file_id: idOf(photos[photoIndex++]), vector},
        );
      }
    }
    const currentSaved = await Memory.findOne(scope).lean();
    if (!currentSaved || !(await isActiveAccount(userId))) return false;
    const [current] = await loadChatSources(userId, [currentSaved]);
    const currentFiles = await loadSearchPhotos(userId, [current]);
    if (fingerprint(current, currentFiles) !== initialFingerprint) return false;
    const result = await Memory.updateOne(
      {
        ...scope,
        title: source.title,
        body: source.body,
        tags: source.tags,
        attachments: source.attachments,
      },
      {
        $set: {
          search_index: {
            fingerprint: initialFingerprint,
            version: VECTOR_VERSION,
            chunks,
          },
        },
      },
      {timestamps: false},
    );
    return result.matchedCount === 1;
  } catch (error) {
    const currentSaved = await Memory.findOne(scope).lean();
    const current = currentSaved
      ? (await loadChatSources(userId, [currentSaved]))[0]
      : null;
    if (
      current &&
      fingerprint(current, await loadSearchPhotos(userId, [current])) ===
        initialFingerprint
    ) {
      await Memory.updateOne(
        {
          ...scope,
          title: source.title,
          body: source.body,
          tags: source.tags,
          attachments: source.attachments,
        },
        {
          $set: {
            search_index: {
              fingerprint: initialFingerprint,
              version: VECTOR_VERSION,
              chunks: [],
              retry_after: new Date(Date.now() + 10 * 60_000),
            },
          },
        },
        {timestamps: false},
      );
    }
    throw error;
  } finally {
    await rm(workspace, {recursive: true, force: true});
  }
}
