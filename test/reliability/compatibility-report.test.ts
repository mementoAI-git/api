import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import AiMetric from '../../src/module/database/model/ai-metric';
import File from '../../src/module/database/model/file';
import {createUserFixture} from '../helpers/factories';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';
import {generateCompatibilityReport} from '../../src/scripts/compatibility-report';

describe('compatibility retirement report', () => {
  beforeAll(connectTestDatabase);
  afterEach(clearTestDatabase);
  afterAll(closeTestDatabase);

  it('groups shim use by supported client and retains inventory-backed shims', async () => {
    const now = new Date('2026-08-31T00:00:00.000Z');
    await AiMetric.collection.insertMany([
      {
        event: 'compat.users.profile_post',
        metadata: {client: 'web', version: '6.0.0', build: '900'},
        created_at: new Date('2026-08-30T00:00:00.000Z'),
      },
      {
        event: 'compat.auth.legacy_session_shape',
        metadata: {client: 'ios', version: '4.2.1', build: '802'},
        created_at: new Date('2026-08-29T00:00:00.000Z'),
      },
      {
        event: 'compat.users.profile_post',
        metadata: {client: 'web', version: '5.0.0'},
        created_at: new Date('2026-06-01T00:00:00.000Z'),
      },
    ]);
    await createUserFixture({refresh_token: 'legacy-token'});
    await File.create({
      name: 'legacy.jpg',
      user: 'user-id',
      type: 'image/jpeg',
      size: 10,
      access_mode: 'legacy_public',
    });

    const report = await generateCompatibilityReport({
      now,
      windowDays: 30,
      supportedClients: [
        {client: 'web', version: '6.0.0'},
        {client: 'ios', version: '4.2.1'},
      ],
    });

    expect(report.inventory).toEqual({
      users_with_legacy_refresh_tokens: 1,
      legacy_public_files: 1,
    });
    expect(report.usage).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'compat.users.profile_post',
          client: 'web',
          version: '6.0.0',
          count: 1,
          supported: true,
        }),
      ]),
    );
    expect(report.shims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({id: 'USERS_PROFILE_POST', decision: 'retain'}),
        expect.objectContaining({
          id: 'AUTH_LEGACY_REFRESH',
          decision: 'retain',
        }),
        expect.objectContaining({
          id: 'FILES_LEGACY_BARE_URL',
          decision: 'retain',
        }),
        expect.objectContaining({
          id: 'AUTH_LEGACY_RESPONSE',
          decision: 'client_evidence_required',
        }),
      ]),
    );
  });
});
