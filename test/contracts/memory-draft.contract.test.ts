import request from 'supertest';
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import Memory from '../../src/module/database/model/memory';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';
import {createTestApp} from '../helpers/app';
import {createUserFixture, issueLegacyAccessToken} from '../helpers/factories';

describe('memory draft and status contract', () => {
  beforeAll(connectTestDatabase);
  afterEach(clearTestDatabase);
  afterAll(closeTestDatabase);

  it('allows updating an existing memory with status: "draft"', async () => {
    const user = await createUserFixture();
    const token = issueLegacyAccessToken(user);
    const memory = await Memory.create({
      user: user.id,
      title: 'Initial Draft',
      body: 'Draft body text',
      status: 'draft',
    });

    const response = await request(createTestApp())
      .put(`/memories/${memory.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Updated Draft Title',
        body: 'Updated draft content',
        status: 'draft',
      });

    expect(response.status).toBe(200);
    expect(response.body.message).toBe('Memory updated successfully');
    expect(response.body.data).toMatchObject({
      title: 'Updated Draft Title',
      body: 'Updated draft content',
      status: 'draft',
    });

    const persisted = await Memory.findById(memory.id);
    expect(persisted?.title).toBe('Updated Draft Title');
    expect(persisted?.status).toBe('draft');
  });

  it('allows transitioning an existing memory to status: "save"', async () => {
    const user = await createUserFixture();
    const token = issueLegacyAccessToken(user);
    const memory = await Memory.create({
      user: user.id,
      title: 'Draft ready to publish',
      body: 'Content ready to publish',
      status: 'draft',
    });

    const response = await request(createTestApp())
      .put(`/memories/${memory.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        status: 'save',
      });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      status: 'save',
    });

    const persisted = await Memory.findById(memory.id);
    expect(persisted?.status).toBe('save');
  });

  it('rejects unsupported status values with 422 validation error', async () => {
    const user = await createUserFixture();
    const token = issueLegacyAccessToken(user);
    const memory = await Memory.create({
      user: user.id,
      title: 'Some memory',
      status: 'draft',
    });

    const response = await request(createTestApp())
      .put(`/memories/${memory.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        status: 'invalid-status',
      });

    expect(response.status).toBe(422);
    expect(response.body.message).toBe("Status must be 'draft' or 'save'");
  });

  it('allows creating memory explicitly with status: "draft"', async () => {
    const user = await createUserFixture();
    const token = issueLegacyAccessToken(user);

    const response = await request(createTestApp())
      .post('/memories')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'New Cloud Draft',
        body: 'Cloud draft content',
        status: 'draft',
      });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      title: 'New Cloud Draft',
      status: 'draft',
    });

    await new Promise(resolve => setTimeout(resolve, 100));
  });

  it('lists draft memories when queried with status=draft', async () => {
    const user = await createUserFixture();
    const token = issueLegacyAccessToken(user);

    await Memory.create([
      {user: user.id, title: 'Draft One', status: 'draft', type: 'story'},
      {user: user.id, title: 'Saved Story', status: 'save', type: 'story'},
    ]);

    const generalResponse = await request(createTestApp())
      .get('/memories?status=draft')
      .set('Authorization', `Bearer ${token}`);

    expect(generalResponse.status).toBe(200);
    expect(generalResponse.body.data.docs).toHaveLength(1);
    expect(generalResponse.body.data.docs[0].title).toBe('Draft One');

    const storiesResponse = await request(createTestApp())
      .get('/memories/stories?status=draft')
      .set('Authorization', `Bearer ${token}`);

    expect(storiesResponse.status).toBe(200);
    expect(storiesResponse.body.data.docs).toHaveLength(1);
    expect(storiesResponse.body.data.docs[0].title).toBe('Draft One');
  });
});
