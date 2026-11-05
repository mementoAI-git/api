import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import {
  connectTestDatabase,
  clearTestDatabase,
  closeTestDatabase,
} from '../helpers/database';
import {createUserFixture} from '../helpers/factories';
import User from '../../src/module/database/model/user';
import Usage from '../../src/module/database/model/usage';
import {list as listBeneficiaries} from '../../src/module/api/beneficiary/service';
import Group from '../../src/module/database/model/group';
import File from '../../src/module/database/model/file';
import {labelSchema} from '../../src/module/api/people/dto';
import Beneficiary from '../../src/module/database/model/beneficiary';
import Memory from '../../src/module/database/model/memory';
import * as settings from '../../src/module/api/people/settings';
import * as people from '../../src/module/api/people/service';
import {findReadableMemory} from '../../src/module/api/memory/access';
import {assertConnection} from '../../src/module/api/people/connection';
describe('People connection settings', () => {
  beforeAll(connectTestDatabase);
  afterEach(clearTestDatabase);
  afterAll(closeTestDatabase);
  async function pair() {
    const a = await createUserFixture();
    const b = await createUserFixture();
    const invite = await Beneficiary.create({
      benefactor: a.id,
      user: b.id,
      email: b.email,
      status: 'accepted',
      access_scope: 'shared_only',
      relationship: 'Friend',
    });
    return {a, b, invite};
  }
  it('keeps each participant’s relationship label private to their view', async () => {
    const {a, b} = await pair();
    await settings.updateLabel(a.id, b.id, 'Brother');
    expect((await people.list(b.id)).connections[0].relationship).toBe(
      'Brother',
    );
    expect((await people.list(a.id)).connections[0].relationship).toBe(
      'Friend',
    );
    const outsider = await createUserFixture();
    await expect(
      settings.updateLabel(a.id, outsider.id, 'Family'),
    ).rejects.toMatchObject({statusCode: 404});
  });
  it('removes the connection for both people and revokes original-source recipient access', async () => {
    const {a, b, invite} = await pair();
    const source = await Memory.create({
      user: a.id,
      title: 'Private source',
      status: 'save',
      beneficiaries: [invite.id],
    });
    const group = await Group.create({
      user: a.id,
      name: 'Family',
      members: [invite.id],
    });
    await settings.disconnect(b.id, a.id, false);
    expect(
      (await listBeneficiaries({page: 1, limit: 20}, a.id)).data.docs,
    ).toHaveLength(0);
    expect((await Usage.findOne({user_id: a.id}))?.beneficiary_count).toBe(0);
    expect((await Group.findById(group.id))?.members).toHaveLength(0);
    expect((await people.list(a.id)).connections).toHaveLength(0);
    expect((await people.list(b.id)).connections).toHaveLength(0);
    await expect(assertConnection(a.id, b.id)).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(await findReadableMemory(source.id, {userId: b.id})).toBeNull();
    expect(await Memory.findById(source.id)).not.toBeNull();
  });
  it('persists a block and unblocks only for its owner without restoring access', async () => {
    const {a, b} = await pair();
    await settings.disconnect(b.id, a.id, true);
    expect(await settings.isBlocked(a.id, b.id)).toBe(true);
    expect((await settings.blocked(a.id))[0].user_id).toBe(b.id);
    await expect(settings.unblock(a.id, b.id)).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(await settings.isBlocked(a.id, b.id)).toBe(true);
    await settings.unblock(b.id, a.id);
    expect(await settings.isBlocked(a.id, b.id)).toBe(false);
    await expect(assertConnection(a.id, b.id)).rejects.toMatchObject({
      statusCode: 404,
    });
  });
  it('merges mobile metadata into the existing accepted record and clears all groups without changing scope', async () => {
    const {a, b, invite} = await pair();
    await invite.updateOne({access_scope: 'capsules_only', about: 'Old note'});
    const group = await Group.create({
      user: a.id,
      name: 'Family',
      members: [invite.id],
    });
    await settings.updateLabel(b.id, a.id, 'Dad', 'Papa', {
      about: '',
      group_ids: [],
    });
    const saved = await Beneficiary.findById(invite.id);
    expect(saved).toMatchObject({
      name: 'Papa',
      relationship: 'Dad',
      about: '',
      access_scope: 'capsules_only',
    });
    expect((await Group.findById(group.id))?.members).toEqual([]);
    expect(await Beneficiary.countDocuments()).toBe(1);
    expect((await settings.getSettings(b.id, a.id)).display_name).toBe('Papa');
    expect((await User.findById(b.id))?.first_name).not.toBe('Papa');
  });
  it('keeps the other participant’s metadata separate and creates only a shared-only reciprocal recipient when needed', async () => {
    const {a, b, invite} = await pair();
    const group = await Group.create({
      user: b.id,
      name: 'Friends',
      members: [],
    });
    await settings.updateLabel(a.id, b.id, 'Friend', 'My friend', {
      about: 'Local note',
      group_ids: [group.id],
    });
    const reciprocal = await Beneficiary.findOne({
      benefactor: b.id,
      user: a.id,
    });
    expect(reciprocal).toMatchObject({
      access_scope: 'shared_only',
      about: 'Local note',
    });
    expect((await Group.findById(group.id))?.members).toEqual([reciprocal!.id]);
    expect((await Beneficiary.findById(invite.id))?.about).toBe('');
    expect((await settings.getSettings(b.id, a.id)).about).toBe('');
  });
  it('rejects another owner’s groups and photos before changing relationship metadata', async () => {
    const {a, b, invite} = await pair();
    const foreignGroup = await Group.create({
      user: b.id,
      name: 'Private group',
      members: [],
    });
    const photo = await File.create({
      user: b.id,
      type: 'image/png',
      name: 'private.png',
      url: 'https://example.com/private.png',
    });
    await expect(
      settings.updateLabel(b.id, a.id, 'Changed', undefined, {
        group_ids: [foreignGroup.id],
      }),
    ).rejects.toMatchObject({statusCode: 400});
    await expect(
      settings.updateLabel(b.id, a.id, 'Changed', undefined, {
        avatar_file_id: photo.id,
      }),
    ).rejects.toMatchObject({statusCode: 400});
    expect((await Beneficiary.findById(invite.id))?.relationship).toBe(
      'Friend',
    );
    expect(
      labelSchema.safeParse({
        params: {personId: b.id},
        body: {label: 'Friend', email: 'changed@example.com'},
      }).success,
    ).toBe(false);
  });
});
