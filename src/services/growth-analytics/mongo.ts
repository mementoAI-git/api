import AnalyticsEvent from '../../module/database/model/analytics-event';
import type {GrowthOutboxStore} from './core';

export function createMongoGrowthOutboxStore(): GrowthOutboxStore {
  let indexes: Promise<void> | undefined;
  // The API connection disables autoIndex. Never enqueue before the unique
  // receipt index exists; createIndexes only adds these owned indexes.
  function ready(): Promise<void> {
    if (!indexes)
      indexes = AnalyticsEvent.createIndexes()
        .then(() => {})
        .catch(error => {
          indexes = undefined;
          throw error;
        });
    return indexes;
  }
  return {
    async insert(event) {
      await ready();
      try {
        await AnalyticsEvent.updateOne(
          {key: event.key},
          {$setOnInsert: event},
          {upsert: true},
        );
      } catch (error) {
        // Concurrent first writes may race the unique index; both represent one event.
        if ((error as {code?: number}).code !== 11000) throw error;
      }
    },
    async claim(now, owner, until) {
      await ready();
      return AnalyticsEvent.findOneAndUpdate(
        {
          deliveredAt: {$exists: false},
          nextAttemptAt: {$lte: now},
          $or: [{leaseUntil: {$exists: false}}, {leaseUntil: {$lte: now}}],
        },
        {$set: {owner, leaseUntil: until}, $inc: {attempts: 1}},
        {new: true, sort: {nextAttemptAt: 1}},
      )
        .lean()
        .exec();
    },
    async delivered(key, owner, at) {
      await AnalyticsEvent.updateOne(
        {key, owner, deliveredAt: {$exists: false}},
        {$set: {deliveredAt: at}, $unset: {owner: 1, leaseUntil: 1}},
      );
    },
    async retry(key, owner, at) {
      await AnalyticsEvent.updateOne(
        {key, owner, deliveredAt: {$exists: false}},
        {$set: {nextAttemptAt: at}, $unset: {owner: 1, leaseUntil: 1}},
      );
    },
  };
}
