import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {test} from 'vitest';
import {serializeExploreCatalog} from '../../src/module/database/seed/explore-catalog.generate';

const snapshot = resolve(
  process.cwd(),
  '../memento-web/src/features/explore/explore-catalog.generated.json',
);

void test.skipIf(!existsSync(snapshot))(
  'bundled web catalog matches the API source of truth',
  () => {
    assert.deepEqual(
      JSON.parse(readFileSync(snapshot, 'utf8')),
      JSON.parse(serializeExploreCatalog()),
      'Run npm run explore:catalog after changing the taxonomy',
    );
  },
);
