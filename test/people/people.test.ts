import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import Beneficiary from '../../src/module/database/model/beneficiary';
import Group from '../../src/module/database/model/group';
import Memory from '../../src/module/database/model/memory';
import File from '../../src/module/database/model/file';
import SharedSpace from '../../src/module/database/model/shared-space';
import {normalizeCapsuleRecipients} from '../../src/module/api/capsule/recipients';
import * as people from '../../src/module/api/people/service';
import {findReadableMemory} from '../../src/module/api/memory/access';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';
import {createUserFixture} from '../helpers/factories';

describe('People relationship archive', () => {
  beforeAll(connectTestDatabase);
  afterEach(clearTestDatabase);
  afterAll(closeTestDatabase);

  async function pair(scope = 'shared_only') {
    const a = await createUserFixture({first_name: 'Wisdom'});
    const b = await createUserFixture({first_name: 'Tunde'});
    const invite = await Beneficiary.create({
      benefactor: a.id,
      user: b.id,
      name: 'Tunde',
      email: b.email,
      relationship: 'Friend',
      status: 'accepted',
      access_scope: scope,
    });
    return {a, b, invite};
  }

  it('lists both sides once even when reciprocal accepted invites exist', async () => {
    const {a, b} = await pair();
    await Beneficiary.create({
      benefactor: b.id,
      user: a.id,
      email: a.email,
      status: 'accepted',
    });
    expect((await people.list(a.id)).connections).toMatchObject([
      {user_id: b.id, memento_state: 'private'},
    ]);
    expect((await people.list(b.id)).connections).toMatchObject([
      {user_id: a.id},
    ]);
    expect((await people.list(a.id)).connections).toHaveLength(1);
    const left = await people.space(b.id, a.id, {page: 1, limit: 20});
    const right = await people.space(a.id, b.id, {page: 1, limit: 20});
    expect(left.shared_space_id).toBe(right.shared_space_id);
  });

  it('keeps pending invitations out of shared spaces', async () => {
    const {a, b, invite} = await pair();
    invite.status = 'pending';
    await invite.save();
    expect((await people.list(a.id)).pending).toMatchObject([
      {invite_id: invite.id},
    ]);
    expect((await people.list(a.id)).connections).toHaveLength(0);
    await expect(
      people.space(b.id, a.id, {page: 1, limit: 20}),
    ).rejects.toMatchObject({statusCode: 404});
  });

  it('references only explicit pair sharing and reads current group membership', async () => {
    const {a, b, invite} = await pair();
    const outsider = await createUserFixture();
    const group = await Group.create({
      user: a.id,
      name: 'Family',
      members: [invite.id],
    });
    const direct = await Memory.create({
      user: a.id,
      title: 'Direct',
      type: 'story',
      status: 'save',
      beneficiaries: [invite.id],
    });
    const grouped = await Memory.create({
      user: a.id,
      title: 'Group',
      type: 'story',
      status: 'save',
      groups: [group.id],
    });
    const everyone = await Memory.create({
      user: b.id,
      title: 'Everyone',
      type: 'story',
      status: 'save',
      visibility: 'everyone',
    });
    await Memory.create({
      user: a.id,
      title: 'Private',
      type: 'story',
      status: 'save',
    });
    await Memory.create({
      user: a.id,
      title: 'Draft',
      type: 'story',
      status: 'draft',
      visibility: 'everyone',
    });
    await Memory.create({
      user: a.id,
      title: 'Deleted',
      type: 'story',
      status: 'deleted',
      visibility: 'everyone',
    });
    await Memory.create({
      user: a.id,
      title: 'Private conversation',
      type: 'conversation',
      status: 'save',
      beneficiaries: [invite.id],
    });
    await Memory.create({
      user: outsider.id,
      title: 'Unrelated',
      type: 'story',
      status: 'save',
      visibility: 'everyone',
    });
    const read = () => people.space(b.id, a.id, {page: 1, limit: 20});
    const first = await read();
    expect(first.items.map(item => item.source_id).sort()).toEqual(
      [direct.id, grouped.id, everyone.id].sort(),
    );
    expect(
      first.items.find(item => item.source_id === direct.id),
    ).toMatchObject({
      contributor: {user_id: a.id},
      shared_via: 'individual_visibility',
    });
    expect(await Memory.countDocuments()).toBe(8);
    group.members = [];
    await group.save();
    expect((await read()).items.map(item => item.source_id)).not.toContain(
      grouped.id,
    );
    direct.beneficiaries = [];
    await direct.save();
    expect((await read()).items.map(item => item.source_id)).not.toContain(
      direct.id,
    );
    everyone.status = 'deleted';
    await everyone.save();
    expect((await read()).items).toHaveLength(0);
  });

  it('requires an accepted connection on every read and rejects unrelated viewers', async () => {
    const {a, b, invite} = await pair();
    const outsider = await createUserFixture();
    await expect(
      people.space(b.id, outsider.id, {page: 1, limit: 20}),
    ).rejects.toMatchObject({statusCode: 404});
    await people.space(b.id, a.id, {page: 1, limit: 20});
    await invite.deleteOne();
    await expect(
      people.space(b.id, a.id, {page: 1, limit: 20}),
    ).rejects.toMatchObject({statusCode: 404});
  });

  it('honors legacy restricted scopes while shared_only permits just explicit stories', async () => {
    const {a, b, invite} = await pair('capsules_only');
    const shared = await Memory.create({
      user: a.id,
      type: 'story',
      title: 'Shared',
      status: 'save',
      beneficiaries: [invite.id],
    });
    const privateStory = await Memory.create({
      user: a.id,
      type: 'story',
      title: 'Private',
      status: 'save',
    });
    expect(
      (await people.space(b.id, a.id, {page: 1, limit: 20})).items,
    ).toHaveLength(0);
    invite.access_scope = 'shared_only';
    await invite.save();
    expect(await findReadableMemory(shared.id, {userId: b.id})).not.toBeNull();
    expect(
      await findReadableMemory(privateStory.id, {userId: b.id}),
    ).toBeNull();
    expect(
      (await people.space(b.id, a.id, {page: 1, limit: 20})).items,
    ).toHaveLength(1);
    await expect(
      normalizeCapsuleRecipients([invite.id], a.id),
    ).rejects.toMatchObject({statusCode: 400});
  });

  it('filters media before pagination and excludes deleted attachments', async () => {
    const {a, b, invite} = await pair();
    const photo = await File.create({
      user: a.id,
      type: 'image/jpeg',
      name: 'trip.jpg',
    });
    const deleted = await File.create({
      user: a.id,
      type: 'image/jpeg',
      name: 'deleted.jpg',
      deleted: true,
    });
    await Memory.create({
      user: a.id,
      title: 'Photo story',
      type: 'story',
      status: 'save',
      beneficiaries: [invite.id],
      attachments: [photo.id, deleted.id],
      created_at: new Date('2026-01-01'),
    });
    await Memory.create({
      user: a.id,
      title: 'Text story',
      type: 'story',
      status: 'save',
      beneficiaries: [invite.id],
      created_at: new Date('2026-02-01'),
    });
    const result = await people.space(b.id, a.id, {
      page: 1,
      limit: 1,
      filter: 'photos',
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].title).toBe('Photo story');
    expect(result.items[0].attachments.map(file => file._id)).toEqual([
      photo.id,
    ]);
    expect(result.total).toBe(1);
    expect(result.has_next_page).toBe(false);
    const all = await people.space(b.id, a.id, {page: 1, limit: 1});
    expect(all.items[0].title).toBe('Text story');
    expect(all.has_next_page).toBe(true);
  });

  it('resolves concurrent relationship reads into one canonical space', async () => {
    const {a, b} = await pair();
    const spaces = await Promise.all([
      people.space(a.id, b.id, {page: 1, limit: 20}),
      people.space(b.id, a.id, {page: 1, limit: 20}),
      people.space(a.id, b.id, {page: 1, limit: 20}),
    ]);
    expect(new Set(spaces.map(value => value.shared_space_id)).size).toBe(1);
    expect(await SharedSpace.countDocuments()).toBe(1);
  });
});
