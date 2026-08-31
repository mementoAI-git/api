import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import AiMetric from '../../src/module/database/model/ai-metric';
import {recordCompatibilityUse} from '../../src/services/compatibility-telemetry';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';

describe('compatibility telemetry', () => {
  beforeAll(connectTestDatabase);
  afterEach(clearTestDatabase);
  afterAll(closeTestDatabase);

  it('persists bounded client metadata for shim-removal reporting', async () => {
    await recordCompatibilityUse('compat.users.profile_post', {
      client: 'ios',
      version: '4.2.1',
      build: '802',
      requestId: 'request-id',
    });

    expect(
      await AiMetric.findOne({event: 'compat.users.profile_post'}).lean(),
    ).toMatchObject({
      event: 'compat.users.profile_post',
      metadata: {client: 'ios', version: '4.2.1', build: '802'},
    });
  });
});
