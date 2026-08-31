import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import AiMetric from '../../src/module/database/model/ai-metric';
import PurgeCommand from '../../src/module/database/model/purge-command';
import {collectOperationalSignals} from '../../src/services/operational-signals';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';

describe('operational signals', () => {
  beforeAll(connectTestDatabase);
  afterEach(clearTestDatabase);
  afterAll(closeTestDatabase);

  it('reports persisted compatibility use and the latest measured usage drift', async () => {
    await AiMetric.create([
      {event: 'compat.users.profile_post'},
      {
        event: 'billing.usage_reconciliation',
        metadata: {processed: 10, drifted: 3},
      },
    ]);

    await expect(collectOperationalSignals()).resolves.toMatchObject({
      compatibility_events_24h: 1,
      usage_drift_records: 3,
    });
  });

  it('includes a stale running purge in the oldest purge age', async () => {
    const createdAt = new Date(Date.now() - 60 * 60 * 1000);
    await PurgeCommand.create({
      user_id: 'stuck-user',
      email: null,
      schema_version: 1,
      status: 'running',
      attempts: 1,
      available_at: createdAt,
      started_at: new Date(Date.now() - 16 * 60 * 1000),
      created_at: createdAt,
    });

    const signals = await collectOperationalSignals();
    expect(signals.purge_oldest_age_seconds).toBeGreaterThanOrEqual(3500);
  });
});
