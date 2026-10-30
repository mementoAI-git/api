import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
import mongoose from 'mongoose';
import {
  connectTestDatabase,
  clearTestDatabase,
  closeTestDatabase,
} from '../helpers/database';
import Memory from '../../src/module/database/model/memory';
import File from '../../src/module/database/model/file';
import Message from '../../src/module/database/model/message';
import Bookmark from '../../src/module/database/model/bookmarks';
import Capsule from '../../src/module/database/model/capsule';
import {
  moveMemoryToDeleted,
  recoverDeletedMemory,
  requestMemoryPurge,
  purgeExpiredMemories,
  backfillMemoryRecovery,
} from '../../src/services/memory-lifecycle';
const {deleteObject} = vi.hoisted(() => ({
  deleteObject: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/services/storage', () => ({
  deleteFileEverywhere: deleteObject,
}));
const now = new Date('2026-10-15T12:00:00Z');
const later = (days: number) => new Date(now.getTime() + days * 86400000);
const create = () =>
  Memory.create({
    user: 'owner',
    title: 'Keep me',
    body: 'My memory',
    status: 'save',
  });

describe('30-day memory recovery', () => {
  beforeAll(connectTestDatabase);
  afterEach(async () => {
    await clearTestDatabase();
    vi.clearAllMocks();
    deleteObject.mockResolvedValue(undefined);
  });
  afterAll(closeTestDatabase);
  it('records deletion time without changing creation time and keeps the deadline on repeated deletes', async () => {
    const original = await create();
    const deleted = await moveMemoryToDeleted(original.id, 'owner', now);
    expect(deleted.status).toBe('deleted');
    expect(deleted.deleted_at).toEqual(now);
    expect(deleted.delete_after).toEqual(later(30));
    expect(deleted.created_at).toEqual(original.created_at);
    expect(
      (await moveMemoryToDeleted(original.id, 'owner', later(2))).delete_after,
    ).toEqual(later(30));
  });
  it('restores to active memories, clears recovery dates and returns the updated document', async () => {
    const original = await create();
    await moveMemoryToDeleted(original.id, 'owner', now);
    const restored = await recoverDeletedMemory(original.id, 'owner', later(1));
    expect(restored.status).toBe('save');
    expect(restored.deleted_at).toBeUndefined();
    expect(restored.delete_after).toBeUndefined();
    expect(await Memory.countDocuments({status: 'deleted'})).toBe(0);
    expect(await Memory.countDocuments({status: 'save'})).toBe(1);
    expect(await purgeExpiredMemories(later(31))).toBe(0);
    expect(await Memory.findById(original.id)).not.toBeNull();
  });
  it('enforces ownership on delete, restore and permanent deletion', async () => {
    const memory = await create();
    await expect(
      moveMemoryToDeleted(memory.id, 'other', now),
    ).rejects.toMatchObject({statusCode: 404});
    await moveMemoryToDeleted(memory.id, 'owner', now);
    await expect(
      recoverDeletedMemory(memory.id, 'other', now),
    ).rejects.toMatchObject({statusCode: 404});
    await expect(
      requestMemoryPurge(memory.id, 'other', now),
    ).rejects.toMatchObject({statusCode: 404});
  });
  it('rejects recovery at the exact expiry time and purges only expired deleted rows', async () => {
    const expired = await create();
    const active = await create();
    await moveMemoryToDeleted(expired.id, 'owner', now);
    await expect(
      recoverDeletedMemory(expired.id, 'owner', later(30)),
    ).rejects.toMatchObject({statusCode: 400});
    expect(await purgeExpiredMemories(later(30))).toBe(1);
    expect(await Memory.findById(expired.id)).toBeNull();
    expect(await Memory.findById(active.id)).not.toBeNull();
  });
  it('requires deleted status for permanent deletion and blocks recovery once purge is claimed', async () => {
    const memory = await create();
    await expect(
      requestMemoryPurge(memory.id, 'owner', now),
    ).rejects.toMatchObject({statusCode: 400});
    await moveMemoryToDeleted(memory.id, 'owner', now);
    await requestMemoryPurge(memory.id, 'owner', now);
    await expect(
      recoverDeletedMemory(memory.id, 'owner', now),
    ).rejects.toMatchObject({statusCode: 400});
    expect(await purgeExpiredMemories(now)).toBe(1);
    expect(await Memory.findById(memory.id)).toBeNull();
  });
  it('gives legacy deleted rows a fresh stable recovery window without changing updated_at', async () => {
    const memory = await Memory.create({user: 'owner', status: 'deleted'});
    const updated = memory.updated_at;
    await backfillMemoryRecovery(mongoose.connection.db!, now);
    await backfillMemoryRecovery(mongoose.connection.db!, later(2));
    const saved = await Memory.findById(memory.id);
    expect(saved?.deleted_at).toEqual(now);
    expect(saved?.delete_after).toEqual(later(30));
    expect(saved?.updated_at).toEqual(updated);
  });
  it('cleans up messages/bookmarks and unshared media, preserving files used by another memory or capsule', async () => {
    const own = await File.create({
      user: 'owner',
      name: 'own.webp',
      type: 'image/webp',
    });
    const shared = await File.create({
      user: 'owner',
      name: 'shared.webp',
      type: 'image/webp',
    });
    const capsuleFile = await File.create({
      user: 'owner',
      name: 'capsule.webp',
      type: 'image/webp',
    });
    const voice = await File.create({
      user: 'owner',
      name: 'voice.webm',
      type: 'audio/webm',
    });
    const memory = await create();
    await memory.updateOne({attachments: [own.id, shared.id, capsuleFile.id]});
    await Memory.create({
      user: 'owner',
      status: 'save',
      attachments: [shared.id],
    });
    await Capsule.create({
      user: 'owner',
      title: 'Capsule',
      attachments: [capsuleFile.id],
    });
    await Message.create({
      memory: memory.id,
      user: 'owner',
      text: 'voice',
      attatchments: [voice.id],
    });
    await Bookmark.create({user: 'owner', memory: memory.id});
    await moveMemoryToDeleted(memory.id, 'owner', now);
    await requestMemoryPurge(memory.id, 'owner', now);
    expect(await purgeExpiredMemories(now)).toBe(1);
    expect(await Message.countDocuments({memory: memory.id})).toBe(0);
    expect(await Bookmark.countDocuments({memory: memory.id})).toBe(0);
    expect(await File.findById(own.id)).toBeNull();
    expect(await File.findById(voice.id)).toBeNull();
    expect(await File.findById(shared.id)).not.toBeNull();
    expect(await File.findById(capsuleFile.id)).not.toBeNull();
    expect(deleteObject).toHaveBeenCalledTimes(2);
  });
  it('retains durable cleanup references when storage fails and completes on retry', async () => {
    const file = await File.create({
      user: 'owner',
      name: 'retry.webp',
      type: 'image/webp',
    });
    const memory = await create();
    await memory.updateOne({attachments: [file.id]});
    await moveMemoryToDeleted(memory.id, 'owner', now);
    await requestMemoryPurge(memory.id, 'owner', now);
    deleteObject.mockRejectedValueOnce(new Error('Storage unavailable'));
    await expect(purgeExpiredMemories(now)).rejects.toThrow();
    expect(await Memory.findById(memory.id)).not.toBeNull();
    await expect(
      recoverDeletedMemory(memory.id, 'owner', now),
    ).rejects.toMatchObject({statusCode: 400});
    expect(await purgeExpiredMemories(now)).toBe(1);
    expect(await Memory.findById(memory.id)).toBeNull();
  });
  it('allows only one winner when restoration races permanent deletion', async () => {
    const memory = await create();
    await moveMemoryToDeleted(memory.id, 'owner', now);
    const results = await Promise.allSettled([
      recoverDeletedMemory(memory.id, 'owner', now),
      requestMemoryPurge(memory.id, 'owner', now),
    ]);
    expect(
      results.filter(result => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const current = await Memory.findById(memory.id);
    if (current?.status === 'save') {
      expect(current.purge_requested_at).toBeUndefined();
      expect(await purgeExpiredMemories(later(31))).toBe(0);
    } else {
      expect(current?.purge_requested_at).toBeDefined();
      expect(await purgeExpiredMemories(now)).toBe(1);
    }
  });
});
