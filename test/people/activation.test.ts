import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import {
  connectTestDatabase,
  clearTestDatabase,
  closeTestDatabase,
} from '../helpers/database';
import {createUserFixture} from '../helpers/factories';
import * as activation from '../../src/module/api/people/activation';
import User from '../../src/module/database/model/user';
import Beneficiary from '../../src/module/database/model/beneficiary';
import * as people from '../../src/module/api/people/service';
describe('connection-facing activation', () => {
  beforeAll(connectTestDatabase);
  afterEach(clearTestDatabase);
  afterAll(closeTestDatabase);
  it('defaults private, becomes ready only with approved context and activates only on explicit opt-in', async () => {
    const user = await createUserFixture();
    expect((await activation.get(user.id)).state).toBe('private');
    await activation.update(user.id, {
      approved_context: 'I enjoy gardening.',
      active: false,
    });
    expect((await activation.get(user.id)).state).toBe('ready');
    await activation.update(user.id, {
      approved_context: 'I enjoy gardening.',
      active: true,
    });
    expect((await activation.get(user.id)).state).toBe('active');
    expect((await User.findById(user.id))?.connection_memento).toBeUndefined();
  });
  it('rejects activation without approved context and leaves connections intact on deactivation', async () => {
    const a = await createUserFixture();
    const b = await createUserFixture();
    await Beneficiary.create({
      benefactor: a.id,
      user: b.id,
      email: b.email,
      status: 'accepted',
      access_scope: 'shared_only',
    });
    await expect(
      activation.update(a.id, {approved_context: '', active: true}),
    ).rejects.toMatchObject({statusCode: 400});
    await activation.update(a.id, {
      approved_context: 'Approved facts only',
      active: true,
    });
    expect((await people.list(b.id)).connections[0].memento_state).toBe(
      'active',
    );
    await activation.update(a.id, {
      approved_context: 'Approved facts only',
      active: false,
    });
    expect((await people.list(b.id)).connections[0].memento_state).toBe(
      'ready',
    );
    expect(
      (await people.space(a.id, b.id, {page: 1, limit: 20})).items,
    ).toEqual([]);
  });
});
