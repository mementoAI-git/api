import assert from 'node:assert/strict';
import {test} from 'vitest';
import {
  buildForwardMigrationUpdate,
  buildReverseMigrationUpdate,
} from '../../src/module/database/migrations/explore-topics-v2';

void test('builds reversible legacy category updates without touching ids', () => {
  assert.deepEqual(buildForwardMigrationUpdate('career'), {
    $set: {
      legacy_category: 'career',
      category: 'work-purpose',
      source: 'legacy',
      active: false,
    },
  });
  assert.deepEqual(buildForwardMigrationUpdate('region'), {
    $set: {
      legacy_category: 'region',
      category: 'beliefs-faith',
      source: 'legacy',
      active: false,
    },
  });
  assert.equal(buildForwardMigrationUpdate('unknown'), null);
  assert.deepEqual(buildReverseMigrationUpdate('identity'), {
    $set: {category: 'identity', active: true},
    $unset: {legacy_category: '', source: ''},
  });
});
