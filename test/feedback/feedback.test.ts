import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';

vi.mock('../../src/module/mail', () => ({
  default: {
    sendFeedbackConfirmation: vi.fn(),
    notifyTeamFeedback: vi.fn(),
  },
}));

vi.mock('../../src/services/discord', () => ({
  default: {
    notifyFeedback: vi.fn(),
  },
}));

vi.mock('../../src/module/api/user/service', () => ({
  getProfile: vi.fn(async (userId: string) => ({
    message: 'Profile retrieved',
    data: {id: userId, fullname: 'Test User'},
  })),
}));

import {createFeedback} from '../../src/module/api/feedback/service';
import Feedback from '../../src/module/database/model/feedback';
import File from '../../src/module/database/model/file';
import {createFeedbackSchema} from '../../src/module/api/feedback/validator';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestReplicaSet,
} from '../helpers/database';
import {createUserFixture} from '../helpers/factories';

describe('Feedback Multi-Screenshot Support', () => {
  beforeAll(connectTestReplicaSet);
  afterEach(clearTestDatabase);
  afterAll(closeTestDatabase);

  it('persists multiple screenshots and maintains primary screenshot backward compatibility', async () => {
    const user = await createUserFixture();
    const files = await File.create(
      [1, 2, 3].map(index => ({
        user: user.id,
        name: `feedback-owned-${index}.jpg`,
        type: 'image/jpeg',
        size: 100,
      })),
    );
    const screenshotIds = files.map(file => String(file._id));

    const res = await createFeedback(
      {
        type: 'Bug',
        email: user.email,
        message: 'Multiple screenshots attached for reproduction',
        screenshots: screenshotIds,
      } as any,
      user.id,
    );

    expect(res.data).toBeDefined();
    expect(res.data.screenshot).toBe(screenshotIds[0]);
    expect(res.data.screenshots).toEqual(screenshotIds);
    expect(String(res.data.user)).toBe(user.id);

    const saved = await Feedback.findById(res.data.id);
    expect(saved?.screenshot).toBe(screenshotIds[0]);
    expect(saved?.screenshots).toEqual(screenshotIds);
    expect(String(saved?.user)).toBe(user.id);
  });

  it('falls back to single screenshot if screenshots array is not provided', async () => {
    const user = await createUserFixture();
    const file = await File.create({
      user: user.id,
      name: 'feedback-single.jpg',
      type: 'image/jpeg',
      size: 100,
    });

    const res = await createFeedback(
      {
        type: 'Feature Request',
        email: user.email,
        message: 'Single screenshot feedback',
        screenshot: String(file._id),
      } as any,
      user.id,
    );

    expect(res.data.screenshot).toBe(String(file._id));
    expect(res.data.screenshots).toEqual([String(file._id)]);
  });

  it('rejects screenshots owned by another user without disclosing ownership', async () => {
    const owner = await createUserFixture();
    const submitter = await createUserFixture();
    const file = await File.create({
      user: owner.id,
      name: 'feedback-foreign.jpg',
      type: 'image/jpeg',
      size: 100,
    });

    await expect(
      createFeedback(
        {
          type: 'Bug',
          email: submitter.email,
          message: 'Cannot attach a foreign screenshot',
          screenshots: [String(file._id)],
        },
        submitter.id,
      ),
    ).rejects.toThrow('One or more screenshots are unavailable.');
  });

  it.each([
    {name: 'deleted', type: 'image/jpeg', deleted: true},
    {name: 'non-image', type: 'application/pdf', deleted: false},
  ])('rejects $name screenshot files', async fileState => {
    const user = await createUserFixture();
    const file = await File.create({
      user: user.id,
      name: `feedback-${fileState.name}`,
      type: fileState.type,
      deleted: fileState.deleted,
      size: 100,
    });

    await expect(
      createFeedback(
        {
          type: 'Bug',
          email: user.email,
          message: 'Unavailable attachment',
          screenshots: [String(file._id)],
        },
        user.id,
      ),
    ).rejects.toThrow('One or more screenshots are unavailable.');
  });

  it('deduplicates screenshot ids while preserving their order', async () => {
    const user = await createUserFixture();
    const file = await File.create({
      user: user.id,
      name: 'feedback-duplicate.jpg',
      type: 'image/jpeg',
      size: 100,
    });
    const id = String(file._id);

    const result = await createFeedback(
      {
        type: 'Bug',
        email: user.email,
        message: 'Duplicate attachment',
        screenshots: [id, id],
      },
      user.id,
    );

    expect(result.data.screenshots).toEqual([id]);
  });

  it('strictly validates feedback type, email, message, ids, and screenshot count', () => {
    const validId = '507f1f77bcf86cd799439011';
    expect(() =>
      createFeedbackSchema.parse({
        body: {
          type: 'Unknown',
          email: 'not-an-email',
          message: '',
          screenshots: [validId, validId, validId, validId, validId, validId],
          unexpected: true,
        },
      }),
    ).toThrow();
    expect(() =>
      createFeedbackSchema.parse({
        body: {
          type: 'Bug',
          email: 'valid@example.com',
          message: 'Valid',
          screenshot: 'not-an-object-id',
        },
      }),
    ).toThrow();
  });
});
