import bcrypt from 'bcryptjs';
import request from 'supertest';
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import aiRoutes from '../../src/module/api/ai/routes';
import Persona from '../../src/module/database/model/persona';
import Prompt from '../../src/module/database/model/prompt';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';
import {createTestApp} from '../helpers/app';
import {createUserFixture, issueLegacyAccessToken} from '../helpers/factories';

describe('endpoint compatibility aliases', () => {
  beforeAll(connectTestDatabase);
  afterEach(clearTestDatabase);
  afterAll(closeTestDatabase);

  it('restores user context and prompt category aliases', async () => {
    const user = await createUserFixture();
    const token = issueLegacyAccessToken(user);
    await Persona.create({
      user: user.id,
      important_notes: ['Values family time'],
      key_preferences: ['Warm prompts'],
    });
    await Prompt.create([
      {
        title: 'One',
        type: 'story',
        category: 'people-i-love',
        source: 'starter',
      },
      {title: 'Two', type: 'story', category: 'who-i-am', source: 'starter'},
      {
        title: 'Three',
        type: 'story',
        category: 'people-i-love',
        source: 'starter',
      },
    ]);

    const context = await request(createTestApp())
      .get('/users/context')
      .set('Authorization', `Bearer ${token}`);
    const categories = await request(createTestApp())
      .get('/prompts/categories')
      .set('Authorization', `Bearer ${token}`);
    const familyPrompts = await request(createTestApp())
      .get('/prompts/categories/Family')
      .set('Authorization', `Bearer ${token}`);

    expect(context.status).toBe(200);
    expect(context.body.data).toMatchObject({
      important_notes: ['Values family time'],
      key_preferences: ['Warm prompts'],
    });
    expect(categories.status).toBe(200);
    expect(categories.body.data).toHaveLength(11);
    expect(categories.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slug: 'people-i-love',
          title: 'People I Love',
        }),
        expect.objectContaining({slug: 'who-i-am', title: 'Who I Am'}),
      ]),
    );
    expect(familyPrompts.status).toBe(200);
    expect(familyPrompts.body.data.docs).toHaveLength(2);
    expect(
      familyPrompts.body.data.docs.map(
        (prompt: {title: string}) => prompt.title,
      ),
    ).toEqual(expect.arrayContaining(['One', 'Three']));
  });

  it('supports deprecated POST profile with safe updated user data', async () => {
    const user = await createUserFixture({
      password: 'sensitive-password-hash',
    });

    const response = await request(createTestApp())
      .post('/users/profile')
      .set('Authorization', `Bearer ${issueLegacyAccessToken(user)}`)
      .send({fullname: 'Ada Lovelace', nickname: 'Ada'});

    expect(response.status).toBe(200);
    expect(response.body.meta.deprecations).toContain('USERS_PROFILE_POST');
    expect(response.body.data).toMatchObject({
      id: user.id,
      first_name: 'Ada',
      last_name: 'Lovelace',
      fullname: 'Ada Lovelace',
      nickname: 'Ada',
    });
    expect(response.body.data).not.toHaveProperty('password');
    expect(response.body.data).not.toHaveProperty('private_key');
  });

  it('accepts canonical and legacy current-password names but rejects conflicts', async () => {
    const oldPassword = 'OldPassword1!';
    async function changePassword(body: Record<string, string>) {
      const user = await createUserFixture({
        password: await bcrypt.hash(oldPassword, 10),
      });
      return request(createTestApp())
        .post('/users/change-password')
        .set('Authorization', `Bearer ${issueLegacyAccessToken(user)}`)
        .send(body);
    }

    expect(
      (
        await changePassword({
          current_password: oldPassword,
          new_password: 'NewPassword1!',
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await changePassword({
          old_password: oldPassword,
          new_password: 'NewPassword1!',
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await changePassword({
          current_password: oldPassword,
          old_password: 'DifferentPassword1!',
          new_password: 'NewPassword1!',
        })
      ).status,
    ).toBe(422);
  });

  it('registers the new-conversation route only once', () => {
    const stack = (
      aiRoutes as unknown as {
        stack: Array<{route?: {path?: string}}>;
      }
    ).stack;
    expect(
      stack.filter(layer => layer.route?.path === '/conversation/new'),
    ).toHaveLength(1);
  });
});
