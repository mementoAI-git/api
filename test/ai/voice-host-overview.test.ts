import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';

import Beneficiary from '../../src/module/database/model/beneficiary';
import Capsule from '../../src/module/database/model/capsule';
import Memory from '../../src/module/database/model/memory';
import {buildHostOverview} from '../../src/module/api/ai/voice/host-overview';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';
import {createUserFixture} from '../helpers/factories';

describe('buildHostOverview', () => {
  beforeAll(connectTestDatabase);
  afterEach(clearTestDatabase);
  afterAll(closeTestDatabase);

  it('is empty for a host with nothing saved yet', async () => {
    const user = await createUserFixture();
    expect(await buildHostOverview(user.id)).toBe('');
  });

  it("names the host's people with their relationships", async () => {
    const user = await createUserFixture();
    await Beneficiary.create({
      benefactor: user.id,
      name: 'Emeka',
      relationship: 'brother',
      email: 'e@example.com',
    });
    await Beneficiary.create({
      benefactor: user.id,
      name: 'Ada',
      relationship: 'daughter',
      email: 'a@example.com',
    });

    const overview = await buildHostOverview(user.id);

    expect(overview).toContain('Emeka (brother)');
    expect(overview).toContain('Ada (daughter)');
  });

  it('counts saved stories and lists the latest titles, leaving out drafts and deleted ones', async () => {
    const user = await createUserFixture();
    await Memory.create({
      user: user.id,
      type: 'story',
      status: 'save',
      title: "Grandma's kitchen",
      created_at: new Date('2026-01-01'),
    });
    await Memory.create({
      user: user.id,
      type: 'story',
      status: 'save',
      title: 'First day at Shell',
      created_at: new Date('2026-02-01'),
    });
    await Memory.create({
      user: user.id,
      type: 'story',
      status: 'draft',
      title: 'Half-written',
    });
    await Memory.create({
      user: user.id,
      type: 'story',
      status: 'deleted',
      title: 'Gone',
    });

    const overview = await buildHostOverview(user.id);

    expect(overview).toContain('Stories: 2 saved');
    expect(overview.indexOf('First day at Shell')).toBeLessThan(
      overview.indexOf("Grandma's kitchen"),
    );
    expect(overview).not.toContain('Half-written');
    expect(overview).not.toContain('Gone');
  });

  it('summarises capsules and the next one due, but not capsules the host received', async () => {
    const user = await createUserFixture();
    const future = new Date(Date.now() + 365 * 24 * 60 * 60_000);
    await Capsule.create({
      user: user.id,
      title: 'For Ada at 18',
      status: 'scheduled',
      schedule_date: future,
    });
    await Capsule.create({user: user.id, title: 'Unfinished', status: 'draft'});
    await Capsule.create({
      user: user.id,
      title: 'From Mum',
      status: 'received',
    });

    const overview = await buildHostOverview(user.id);

    expect(overview).toContain('1 scheduled');
    expect(overview).toContain('1 draft');
    expect(overview).toContain('For Ada at 18');
    expect(overview).not.toContain('From Mum');
  });

  it('lists recent reflections', async () => {
    const user = await createUserFixture();
    await Memory.create({
      user: user.id,
      type: 'story',
      status: 'save',
      title: 'Smiles',
      prompt_text: 'What made you smile this week?',
    });

    expect(await buildHostOverview(user.id)).toContain(
      'What made you smile this week?',
    );
  });

  it("never includes another user's people, stories or capsules", async () => {
    const user = await createUserFixture();
    const other = await createUserFixture();
    await Beneficiary.create({
      benefactor: other.id,
      name: 'Stranger',
      relationship: 'friend',
      email: 's@example.com',
    });
    await Memory.create({
      user: other.id,
      type: 'story',
      status: 'save',
      title: 'Not yours',
    });
    await Capsule.create({
      user: other.id,
      title: 'Not yours either',
      status: 'scheduled',
    });

    expect(await buildHostOverview(user.id)).toBe('');
  });

  it('stays short however much the host has saved', async () => {
    const user = await createUserFixture();
    for (let i = 0; i < 40; i += 1) {
      await Beneficiary.create({
        benefactor: user.id,
        name: `Person number ${i}`,
        relationship: 'cousin',
        email: `p${i}@example.com`,
      });
    }
    expect((await buildHostOverview(user.id)).length).toBeLessThanOrEqual(
      1_200,
    );
  });
});
