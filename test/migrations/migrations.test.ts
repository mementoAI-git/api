import mongoose from 'mongoose';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import InsightBatch from '../../src/module/database/model/insight-batch';
import ObservationView from '../../src/module/database/model/observation-view';
import Bookmark from '../../src/module/database/model/bookmarks';
import Migration from '../../src/module/database/model/migration';
import AiMetric from '../../src/module/database/model/ai-metric';
import VoiceUsage from '../../src/module/database/model/voice-usage';
import VoiceCall from '../../src/module/database/model/voice-call';
import {
  getMigrationStatus,
  migrateUp,
  type DatabaseMigration,
} from '../../src/migrations';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';

describe('database migrations', () => {
  beforeAll(connectTestDatabase);

  beforeEach(async () => {
    await Migration.deleteMany({});
    await Bookmark.collection
      .dropIndex('bookmark_user_memory_lookup')
      .catch(() => undefined);
  });

  afterEach(clearTestDatabase);
  afterAll(closeTestDatabase);

  it('records each successful migration once across repeated runs', async () => {
    const first = await migrateUp();
    const second = await migrateUp();

    expect(first.every(result => result.status === 'applied')).toBe(true);
    expect(second.every(result => result.status === 'skipped')).toBe(true);
    expect(await Migration.countDocuments()).toBe(first.length);
  });

  it('treats concurrent completion of the same idempotent migration as one application', async () => {
    let executions = 0;
    const migration: DatabaseMigration = {
      id: 'test-concurrent-migration',
      up: async db => {
        executions++;
        await new Promise(resolve => setTimeout(resolve, 25));
        await db
          .collection('migration_probe')
          .updateOne({key: 'singleton'}, {$set: {ready: true}}, {upsert: true});
      },
    };

    const results = await Promise.all([
      migrateUp([migration]),
      migrateUp([migration]),
    ]);

    expect(results.flat()).toEqual(
      expect.arrayContaining([
        {id: migration.id, status: 'applied'},
        {id: migration.id, status: 'skipped'},
      ]),
    );
    expect(await Migration.countDocuments({id: migration.id})).toBe(1);
    expect(executions).toBe(1);
  });

  it('renews a short lease while a long migration is still running', async () => {
    let executions = 0;
    const migration: DatabaseMigration = {
      id: 'test-renewed-migration-lease',
      up: async () => {
        executions++;
        await new Promise(resolve => setTimeout(resolve, 90));
      },
    };
    const options = {leaseMs: 30, pollMs: 5, waitTimeoutMs: 500};

    const first = migrateUp([migration], options);
    await new Promise(resolve => setTimeout(resolve, 50));
    const second = migrateUp([migration], options);

    await expect(Promise.all([first, second])).resolves.toEqual(
      expect.arrayContaining([
        [{id: migration.id, status: 'applied'}],
        [{id: migration.id, status: 'skipped'}],
      ]),
    );
    expect(executions).toBe(1);
  });

  it('reports pending migrations before they run and applied migrations after', async () => {
    expect(await getMigrationStatus()).toEqual(
      expect.arrayContaining([expect.objectContaining({status: 'pending'})]),
    );

    await migrateUp();

    expect(await getMigrationStatus()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: 'applied',
          applied_at: expect.any(Date),
        }),
      ]),
    );
  });

  it('records a failed claim and permits a later retry', async () => {
    let shouldFail = true;
    const failingMigration: DatabaseMigration = {
      id: 'test-failing-migration',
      up: async () => {
        if (shouldFail) throw new Error('migration failed');
      },
    };

    await expect(migrateUp([failingMigration])).rejects.toThrow(
      'migration failed',
    );

    expect(
      await Migration.findOne({id: failingMigration.id}).lean(),
    ).toMatchObject({
      status: 'failed',
      error: 'migration failed',
    });
    await expect(getMigrationStatus([failingMigration])).resolves.toEqual([
      expect.objectContaining({id: 'test-failing-migration', status: 'failed'}),
    ]);

    shouldFail = false;
    await expect(migrateUp([failingMigration])).resolves.toEqual([
      {id: failingMigration.id, status: 'applied'},
    ]);
  });

  it('removes duplicate bookmarks and adds the rollback-safe lookup index', async () => {
    await Bookmark.collection.insertMany([
      {
        user: 'user-1',
        memory: 'memory-1',
        created_at: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        user: 'user-1',
        memory: 'memory-1',
        created_at: new Date('2026-01-02T00:00:00.000Z'),
      },
      {user: 'user-2', memory: 'memory-1'},
    ]);

    await migrateUp();

    const bookmarks = await Bookmark.find({user: 'user-1'}).sort({
      created_at: 1,
    });
    const indexes = await Bookmark.collection.indexes();
    const metricIndexes = await AiMetric.collection.indexes();

    expect(bookmarks).toHaveLength(1);
    expect(bookmarks[0].created_at).toEqual(
      new Date('2026-01-01T00:00:00.000Z'),
    );
    expect(indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'bookmark_user_memory_lookup',
          key: {user: 1, memory: 1},
        }),
      ]),
    );
    expect(metricIndexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'metric_event_client_version_created_at_desc',
          key: {
            event: 1,
            'metadata.client': 1,
            'metadata.version': 1,
            created_at: -1,
          },
        }),
      ]),
    );
  });

  it('creates the unique insight batch index production relies on', async () => {
    await migrateUp();

    const indexes = await mongoose.connection
      .db!.collection(InsightBatch.collection.name)
      .indexes();

    expect(indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({key: {user: 1}, unique: true}),
        expect.objectContaining({key: {'insights.evidence.memory': 1}}),
      ]),
    );
  });

  it('clears insights made under the old rules so they are re-evaluated', async () => {
    const batches = mongoose.connection.db!.collection(
      InsightBatch.collection.name,
    );
    await batches.insertOne({
      user: 'old-rules-user',
      insights: [{title: 'Weak', memories: ['a', 'b']}],
      generated_at: new Date(),
      next_refresh_at: new Date(Date.now() + 86_400_000),
    });

    await migrateUp();

    expect(await batches.findOne({user: 'old-rules-user'})).toMatchObject({
      insights: [],
      generated_at: null,
      next_refresh_at: new Date(0),
    });
  });

  it('creates the unique observation view index', async () => {
    await migrateUp();

    expect(
      await mongoose.connection.db!.collection('observation_views').indexes(),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({key: {user: 1}, unique: true}),
      ]),
    );
    expect(ObservationView.collection.name).toBe('observation_views');
  });

  it('indexes voice usage and copies in calls made before it was tracked', async () => {
    const tracked = Date.parse('2026-11-10T12:00:00Z');
    // A member with history, one call of which is already tracked live.
    await VoiceUsage.create({
      user: 'user-1',
      call_started_at: tracked,
      month: '2026-11',
      seconds: 120,
    });
    await VoiceCall.collection.insertMany([
      {
        user: 'user-1',
        session_id: 'a',
        duration_seconds: 300,
        ended_at: new Date('2026-10-02T10:05:00Z'),
      },
      {
        user: 'user-1',
        session_id: 'b',
        duration_seconds: 120,
        ended_at: new Date(tracked + 120_000),
      },
      {
        user: 'user-2',
        session_id: 'c',
        duration_seconds: 60,
        ended_at: new Date('2026-11-01T09:01:00Z'),
      },
      {
        user: 'user-2',
        session_id: 'd',
        duration_seconds: 0,
        ended_at: new Date('2026-11-02T09:00:00Z'),
      },
    ]);

    await migrateUp();

    const indexes = await mongoose.connection
      .db!.collection(VoiceUsage.collection.name)
      .indexes();
    expect(indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: {user: 1, call_started_at: 1},
          unique: true,
        }),
        expect.objectContaining({key: {user: 1, month: 1}}),
      ]),
    );
    const rows = await VoiceUsage.find(
      {},
      {_id: 0, user: 1, seconds: 1, month: 1},
    )
      .sort({user: 1, call_started_at: 1})
      .lean();
    // The October call is copied in; the tracked call is not counted twice; empty calls are skipped.
    expect(rows).toEqual([
      {user: 'user-1', seconds: 300, month: '2026-10'},
      {user: 'user-1', seconds: 120, month: '2026-11'},
      {user: 'user-2', seconds: 60, month: '2026-11'},
    ]);
    expect(VoiceUsage.collection.name).toBe('voice_usages');
    expect(VoiceCall.collection.name).toBe('voice_calls');
  });
});
