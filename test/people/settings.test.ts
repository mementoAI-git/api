import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import {
  connectTestDatabase,
  clearTestDatabase,
  closeTestDatabase,
} from '../helpers/database';
import {createUserFixture} from '../helpers/factories';
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
    await settings.disconnect(b.id, a.id, false);
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
});
