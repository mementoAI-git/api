import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import mongoose from 'mongoose';
import {MongoMemoryServer} from 'mongodb-memory-server';
import AnalyticsEvent from '../../src/module/database/model/analytics-event';
import {createMongoGrowthOutboxStore} from '../../src/services/growth-analytics/mongo';
import {createGrowthAnalytics} from '../../src/services/growth-analytics/core';

describe('durable growth outbox', () => {
  let server: MongoMemoryServer;
  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    await mongoose.connect(server.getUri(), {autoIndex: false});
  });
  afterAll(async () => {
    await mongoose.disconnect();
    await server?.stop();
  });

  it('enforces unique keys and atomic leases across independent stores', async () => {
    const store = createMongoGrowthOutboxStore();
    const analytics = createGrowthAnalytics({store, publish: async () => {}});
    const event = {
      key: 'account:one',
      event: 'growth_account_created' as const,
      distinctId: 'one',
      properties: {},
    };
    await Promise.all([analytics.record(event), analytics.record(event)]);
    expect(await AnalyticsEvent.countDocuments()).toBe(1);
    expect(
      (await AnalyticsEvent.collection.indexes()).some(
        index => index.key.key === 1 && index.unique,
      ),
    ).toBe(true);
    const now = new Date();
    const [first, second] = await Promise.all([
      store.claim(now, 'first', new Date(now.getTime() + 1000)),
      createMongoGrowthOutboxStore().claim(
        now,
        'second',
        new Date(now.getTime() + 1000),
      ),
    ]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    const leased = (first || second)!;
    await store.delivered(leased.key, 'wrong-owner', now);
    expect((await AnalyticsEvent.findOne())?.deliveredAt).toBeUndefined();
    const recovered = await store.claim(
      new Date(now.getTime() + 1001),
      'recovered',
      new Date(now.getTime() + 2000),
    );
    expect(recovered?.uuid).toBe(leased.uuid);
    await store.delivered(leased.key, 'recovered', now);
    await analytics.record(event);
    expect(await AnalyticsEvent.countDocuments()).toBe(1);
    expect(
      await store.claim(
        new Date(now.getTime() + 3000),
        'late',
        new Date(now.getTime() + 4000),
      ),
    ).toBeNull();
  });
});
