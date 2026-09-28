import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import Beneficiary from '../../src/module/database/model/beneficiary';
import Memory from '../../src/module/database/model/memory';
import {findReadableMemory} from '../../src/module/api/memory/access';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestReplicaSet,
} from '../helpers/database';
import {createUserFixture} from '../helpers/factories';

describe('Beneficiary Access Scope & Benefactor Isolation', () => {
  beforeAll(connectTestReplicaSet);
  afterEach(clearTestDatabase);
  afterAll(closeTestDatabase);

  it('allows access to memory when beneficiary has full_vault or memories_only scope', async () => {
    const benefactor = await createUserFixture();
    const beneficiaryUser = await createUserFixture();

    const beneficiaryDoc = await Beneficiary.create({
      name: 'Vault Heir',
      email: beneficiaryUser.email,
      relationship: 'Friend',
      status: 'accepted',
      access_scope: 'memories_only',
      user: beneficiaryUser.id,
      benefactor: benefactor.id,
    });

    const memory = await Memory.create({
      title: 'Family Heirloom',
      description: 'The story behind the pocket watch',
      status: 'published',
      visibility: 'private',
      user: benefactor.id,
      beneficiaries: [beneficiaryDoc.id],
    });

    const readable = await findReadableMemory(memory.id, {
      userId: beneficiaryUser.id,
    });
    expect(readable).not.toBeNull();
    expect(readable?.id).toBe(memory.id);
  });

  it('denies access to memory when beneficiary has capsules_only scope', async () => {
    const benefactor = await createUserFixture();
    const beneficiaryUser = await createUserFixture();

    const beneficiaryDoc = await Beneficiary.create({
      name: 'Capsule Heir',
      email: beneficiaryUser.email,
      relationship: 'Friend',
      status: 'accepted',
      access_scope: 'capsules_only',
      user: beneficiaryUser.id,
      benefactor: benefactor.id,
    });

    const memory = await Memory.create({
      title: 'Secret Journal',
      description: 'Private reflections',
      status: 'published',
      visibility: 'private',
      user: benefactor.id,
      beneficiaries: [beneficiaryDoc.id],
    });

    const readable = await findReadableMemory(memory.id, {
      userId: beneficiaryUser.id,
    });
    expect(readable).toBeNull();
  });

  it('enforces strict benefactor boundary isolation', async () => {
    const benefactorA = await createUserFixture();
    const benefactorB = await createUserFixture();
    const beneficiaryUser = await createUserFixture();

    // Beneficiary is accepted for benefactor A only
    const beneficiaryDoc = await Beneficiary.create({
      name: 'Legitimate Beneficiary',
      email: beneficiaryUser.email,
      relationship: 'Friend',
      status: 'accepted',
      access_scope: 'full_vault',
      user: beneficiaryUser.id,
      benefactor: benefactorA.id,
    });

    // Memory belongs to benefactor B
    const memoryB = await Memory.create({
      title: 'Benefactor B Private Memory',
      description: 'Should not leak to A',
      status: 'published',
      visibility: 'private',
      user: benefactorB.id,
      beneficiaries: [beneficiaryDoc.id],
    });

    const readable = await findReadableMemory(memoryB.id, {
      userId: beneficiaryUser.id,
    });
    expect(readable).toBeNull();
  });
});
