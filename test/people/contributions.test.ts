import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
import {
  connectTestDatabase,
  clearTestDatabase,
  closeTestDatabase,
} from '../helpers/database';
import {createUserFixture} from '../helpers/factories';
import Beneficiary from '../../src/module/database/model/beneficiary';
import Memory from '../../src/module/database/model/memory';
import * as contributions from '../../src/module/api/people/contributions';
import {findReadableMemory} from '../../src/module/api/memory/access';
import * as people from '../../src/module/api/people/service';

vi.mock('../../src/module/api/memory/service', () => ({
  createMemory: async (payload: Record<string, unknown>, userId: string) => {
    const {default: Model} = await import(
      '../../src/module/database/model/memory'
    );
    return {data: await Model.create({...payload, user: userId})};
  },
}));

describe('intentional People contributions', () => {
  beforeAll(connectTestDatabase);
  afterEach(clearTestDatabase);
  afterAll(closeTestDatabase);
  async function pair(status = 'accepted') {
    const a = await createUserFixture();
    const b = await createUserFixture();
    const invite = await Beneficiary.create({
      benefactor: a.id,
      user: b.id,
      email: b.email,
      status,
      access_scope: 'memories_only',
    });
    return {a, b, invite};
  }
  it('allows the incoming participant to share without inviting again or granting vault access', async () => {
    const {a, b, invite} = await pair();
    const source = await Memory.create({
      user: b.id,
      title: 'Our holiday',
      body: 'My perspective',
      status: 'save',
    });
    await Promise.all([
      contributions.share(a.id, b.id, source.id),
      contributions.share(a.id, b.id, source.id),
    ]);
    const recipient = await Beneficiary.findOne({
      benefactor: b.id,
      user: a.id,
      status: 'accepted',
    });
    expect(recipient?.access_scope).toBe('shared_only');
    expect(
      await Beneficiary.countDocuments({
        benefactor: b.id,
        user: a.id,
        status: 'accepted',
      }),
    ).toBe(1);
    expect((await Beneficiary.findById(invite.id))?.access_scope).toBe(
      'memories_only',
    );
    expect(await Memory.countDocuments()).toBe(1);
    expect(await findReadableMemory(source.id, {userId: a.id})).not.toBeNull();
    const archive = await people.space(b.id, a.id, {page: 1, limit: 20});
    expect(archive.items).toMatchObject([
      {source_id: source.id, shared_via: 'share_from_memento'},
    ]);
    expect(archive.items[0].shared_date).toBeTruthy();
    await Memory.updateOne(
      {_id: source.id},
      {$set: {beneficiaries: [], groups: [], visibility: 'private'}},
    );
    expect(
      (await people.space(b.id, a.id, {page: 1, limit: 20})).items,
    ).toHaveLength(0);
  });
  it('rejects pending relationships, foreign sources and drafts', async () => {
    const {a, b, invite} = await pair('pending');
    const source = await Memory.create({
      user: b.id,
      title: 'Mine',
      status: 'save',
    });
    await expect(
      contributions.share(a.id, b.id, source.id),
    ).rejects.toMatchObject({statusCode: 404});
    invite.status = 'accepted';
    await invite.save();
    await expect(
      contributions.share(b.id, a.id, source.id),
    ).rejects.toMatchObject({statusCode: 404});
    source.status = 'draft';
    await source.save();
    await expect(
      contributions.share(a.id, b.id, source.id),
    ).rejects.toMatchObject({statusCode: 404});
  });
  it('removes only this relationship recipient and keeps source and other shares', async () => {
    const {a, b} = await pair();
    const other = await createUserFixture();
    const otherGrant = await Beneficiary.create({
      benefactor: b.id,
      user: other.id,
      email: other.email,
      status: 'accepted',
      access_scope: 'shared_only',
    });
    const source = await Memory.create({
      user: b.id,
      title: 'Mine',
      status: 'save',
      beneficiaries: [otherGrant.id],
    });
    await contributions.share(a.id, b.id, source.id);
    await expect(
      contributions.remove(b.id, a.id, source.id),
    ).rejects.toMatchObject({statusCode: 404});
    await contributions.remove(a.id, b.id, source.id);
    expect((await Memory.findById(source.id))?.beneficiaries).toEqual([
      otherGrant.id,
    ]);
    expect(
      (await people.space(a.id, b.id, {page: 1, limit: 20})).items,
    ).toHaveLength(0);
  });
  it('creates a targeted note and preserves contributor perspective in both archives', async () => {
    const {a, b} = await pair();
    const item = await contributions.contribute(a.id, b.id, {
      title: 'How I remember you',
      body: 'I remember our walk',
      kind: 'note',
      attachments: [],
    });
    expect(item).toMatchObject({
      source_type: 'note',
      shared_via: 'direct',
      contributor: {user_id: b.id},
    });
    const notes = await people.space(b.id, a.id, {
      page: 1,
      limit: 20,
      filter: 'notes',
    });
    expect(notes.items).toHaveLength(1);
    expect(
      await findReadableMemory(item.source_id, {userId: a.id}),
    ).not.toBeNull();
    await contributions.remove(a.id, b.id, item.source_id);
    expect(
      (await people.space(b.id, a.id, {page: 1, limit: 20, filter: 'notes'}))
        .items,
    ).toHaveLength(0);
    expect(await Memory.findById(item.source_id)).not.toBeNull();
  });
  it('rejects empty notes and mismatched media before creating a source', async () => {
    const {a, b} = await pair();
    await expect(
      contributions.contribute(a.id, b.id, {
        title: 'Note',
        body: ' ',
        kind: 'note',
        attachments: [],
      }),
    ).rejects.toMatchObject({statusCode: 400});
    await expect(
      contributions.contribute(a.id, b.id, {
        title: 'Voice',
        body: '',
        kind: 'voice',
        attachments: [],
      }),
    ).rejects.toMatchObject({statusCode: 400});
    expect(await Memory.countDocuments()).toBe(0);
  });
  it('orders a newly shared older source by its actual shared date', async () => {
    const {a, b, invite} = await pair();
    const recent = await Memory.create({
      user: a.id,
      title: 'Previously shared',
      status: 'save',
      beneficiaries: [invite.id],
      created_at: new Date('2026-09-01'),
    });
    const old = await Memory.create({
      user: a.id,
      title: 'Old original',
      status: 'save',
      created_at: new Date('2020-01-01'),
    });
    await contributions.share(b.id, a.id, old.id);
    expect(
      (await people.space(b.id, a.id, {page: 1, limit: 20})).items.map(
        item => item.source_id,
      ),
    ).toEqual([old.id, recent.id]);
  });
});
