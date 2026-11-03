import {model, Schema} from 'mongoose';
import type {OutboxEvent} from '../../../services/growth-analytics/core';

const schema = new Schema<OutboxEvent>(
  {
    key: {type: String, required: true},
    uuid: {type: String, required: true},
    event: {type: String, required: true},
    distinctId: {type: String, required: true},
    timestamp: {type: Date, required: true},
    properties: {type: Schema.Types.Mixed, required: true},
    attempts: {type: Number, default: 0},
    nextAttemptAt: {type: Date, required: true},
    owner: String,
    leaseUntil: Date,
    deliveredAt: Date,
  },
  {versionKey: false, bufferCommands: false},
);
// Keep delivered receipts indefinitely: milestone deduplication outlives delivery.
schema.index({key: 1}, {unique: true});
schema.index({deliveredAt: 1, nextAttemptAt: 1, leaseUntil: 1});
const AnalyticsEvent = model<OutboxEvent>('analytics_event', schema);
export default AnalyticsEvent;
