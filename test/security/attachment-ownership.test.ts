import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import {Types} from 'mongoose';
import File from '../../src/module/database/model/file';
import Memory from '../../src/module/database/model/memory';
import * as fileService from '../../src/module/api/file/service';
import * as memoryService from '../../src/module/api/memory/service';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';
import {createUserFixture} from '../helpers/factories';

describe('attachment ownership', () => {
  beforeAll(connectTestDatabase);
  afterEach(clearTestDatabase);
  afterAll(closeTestDatabase);

  async function createFile(userId: string, name: string) {
    return File.create({
      user: userId,
      name,
      type: 'image/jpeg',
      size: 128,
      provider: 's3',
      backup_at: new Date(),
    });
  }

  it('rejects foreign and missing File IDs during memory creation', async () => {
    const owner = await createUserFixture();
    const attacker = await createUserFixture();
    const foreignFile = await createFile(owner.id, 'owner-photo.jpg');

    for (const fileId of [foreignFile.id, new Types.ObjectId().toString()]) {
      await expect(
        memoryService.createMemory(
          {
            title: 'Tampered memory',
            body: 'Should not persist',
            status: 'save',
            tags: [],
            level: 1,
            attachments: [fileId],
          },
          attacker.id,
        ),
      ).rejects.toMatchObject({statusCode: 404});
    }

    expect(await Memory.countDocuments()).toBe(0);
  });

  it('rejects a foreign File ID during quick capture', async () => {
    const owner = await createUserFixture();
    const attacker = await createUserFixture();
    const foreignFile = await createFile(owner.id, 'quick-photo.jpg');

    await expect(
      memoryService.quickCaptureMemory(
        {body: 'Quick thought', attachments: [foreignFile.id]},
        attacker.id,
      ),
    ).rejects.toMatchObject({statusCode: 404});
    expect(await Memory.countDocuments()).toBe(0);
  });

  it('rejects foreign additions without changing an existing memory', async () => {
    const owner = await createUserFixture();
    const other = await createUserFixture();
    const ownedFile = await createFile(owner.id, 'owned.jpg');
    const foreignFile = await createFile(other.id, 'foreign.jpg');
    const memory = await Memory.create({
      user: owner.id,
      title: 'Original',
      status: 'save',
      attachments: [ownedFile.id],
    });

    await expect(
      memoryService.updateMemory(
        memory.id,
        {attachments: [foreignFile.id]},
        owner.id,
      ),
    ).rejects.toMatchObject({statusCode: 404});

    const unchanged = await Memory.findById(memory.id).lean();
    expect(unchanged?.attachments.map(String)).toEqual([ownedFile.id]);
  });

  it('does not physically delete a referenced file', async () => {
    const owner = await createUserFixture();
    const file = await createFile(owner.id, 'referenced.jpg');
    await Memory.create({
      user: owner.id,
      title: 'Uses file',
      status: 'save',
      attachments: [file.id],
    });

    await expect(
      fileService.removeFile(file.name, owner.id),
    ).rejects.toMatchObject({statusCode: 409});
    expect(await File.findById(file.id)).not.toBeNull();
  });

  it('detaches a file only from the requested owned memory', async () => {
    const owner = await createUserFixture();
    const file = await createFile(owner.id, 'shared-between-memories.jpg');
    const first = await Memory.create({
      user: owner.id,
      title: 'First',
      status: 'save',
      attachments: [file.id],
    });
    const second = await Memory.create({
      user: owner.id,
      title: 'Second',
      status: 'save',
      attachments: [file.id],
    });

    await memoryService.removeFileFromSpecificMemory(
      first.id,
      file.id,
      owner.id,
    );

    expect((await Memory.findById(first.id))?.attachments).toHaveLength(0);
    expect((await Memory.findById(second.id))?.attachments.map(String)).toEqual(
      [file.id],
    );
  });
});
