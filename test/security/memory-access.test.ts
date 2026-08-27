import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import {Types} from 'mongoose';
import Beneficiary from '../../src/module/database/model/beneficiary';
import Bookmark from '../../src/module/database/model/bookmarks';
import Group from '../../src/module/database/model/group';
import Memory from '../../src/module/database/model/memory';
import Message from '../../src/module/database/model/message';
import * as memoryService from '../../src/module/api/memory/service';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';
import {createUserFixture} from '../helpers/factories';

describe('memory access policy', () => {
  beforeAll(connectTestDatabase);
  afterEach(clearTestDatabase);
  afterAll(closeTestDatabase);

  it('hides a private memory from another user', async () => {
    const owner = await createUserFixture();
    const attacker = await createUserFixture();
    const memory = await Memory.create({
      user: owner.id,
      title: 'Private',
      body: 'Owner only',
      status: 'save',
      visibility: 'private',
    });

    await expect(
      memoryService.getMemory(memory.id, attacker.id),
    ).rejects.toMatchObject({statusCode: 404});
  });

  it('allows the owner and public readers', async () => {
    const owner = await createUserFixture();
    const reader = await createUserFixture();
    const privateMemory = await Memory.create({
      user: owner.id,
      title: 'Private',
      status: 'save',
    });
    const publicMemory = await Memory.create({
      user: owner.id,
      title: 'Public',
      status: 'save',
      visibility: 'everyone',
    });

    await expect(
      memoryService.getMemory(privateMemory.id, owner.id),
    ).resolves.toMatchObject({data: {title: 'Private'}});
    await expect(
      memoryService.getMemory(publicMemory.id, reader.id),
    ).resolves.toMatchObject({data: {title: 'Public'}});
  });

  it('allows accepted direct and group beneficiaries to read only', async () => {
    const owner = await createUserFixture();
    const directReader = await createUserFixture();
    const groupReader = await createUserFixture();
    const directBeneficiary = await Beneficiary.create({
      user: directReader.id,
      benefactor: owner.id,
      email: directReader.email,
      name: 'Direct Reader',
      status: 'accepted',
    });
    const groupBeneficiary = await Beneficiary.create({
      user: groupReader.id,
      benefactor: owner.id,
      email: groupReader.email,
      name: 'Group Reader',
      status: 'accepted',
    });
    const group = await Group.create({
      user: owner.id,
      name: 'Family',
      members: [groupBeneficiary.id],
    });
    const directMemory = await Memory.create({
      user: owner.id,
      title: 'Direct share',
      status: 'save',
      beneficiaries: [directBeneficiary.id],
    });
    const groupMemory = await Memory.create({
      user: owner.id,
      title: 'Group share',
      status: 'save',
      groups: [group.id],
    });

    await expect(
      memoryService.getMemory(directMemory.id, directReader.id),
    ).resolves.toMatchObject({data: {title: 'Direct share'}});
    await expect(
      memoryService.getMemory(groupMemory.id, groupReader.id),
    ).resolves.toMatchObject({data: {title: 'Group share'}});

    await expect(
      memoryService.addMessageToMemory(
        {
          memory_id: directMemory.id,
          messages: [{text: 'tamper', role: 'user'}],
        },
        directReader.id,
      ),
    ).rejects.toMatchObject({statusCode: 404});
    expect(await Message.countDocuments({memory: directMemory.id})).toBe(0);
  });

  it('does not let another user bookmark or message a private memory', async () => {
    const owner = await createUserFixture();
    const attacker = await createUserFixture();
    const memory = await Memory.create({
      user: owner.id,
      title: 'Private',
      status: 'save',
    });

    await expect(
      memoryService.bookmark(memory.id, attacker.id),
    ).rejects.toMatchObject({statusCode: 404});
    await expect(
      memoryService.addMessageToMemory(
        {
          memory_id: memory.id,
          messages: [{text: 'tamper', role: 'user'}],
        },
        attacker.id,
      ),
    ).rejects.toMatchObject({statusCode: 404});

    expect(await Bookmark.countDocuments()).toBe(0);
    expect(await Message.countDocuments()).toBe(0);
  });

  it('scopes prompt responses to the authenticated user', async () => {
    const owner = await createUserFixture();
    const attacker = await createUserFixture();
    const promptId = new Types.ObjectId().toString();
    await Memory.create({
      user: owner.id,
      title: 'Owner response',
      status: 'save',
      prompt: promptId,
    });

    await expect(
      memoryService.getMemoryByPrompt(promptId, attacker.id),
    ).rejects.toMatchObject({statusCode: 404});
  });
});
