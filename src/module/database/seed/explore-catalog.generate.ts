import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {EXPLORE_CATEGORIES} from '../../api/prompt/explore-taxonomy';

export function serializeExploreCatalog() {
  return `${JSON.stringify(
    EXPLORE_CATEGORIES.map((category, order) => ({
      ...category,
      order,
      starterTotal: 10,
    })),
    null,
    2,
  )}\n`;
}

if (require.main === module) {
  const target = resolve(
    process.cwd(),
    '../memento-web/src/features/explore/explore-catalog.generated.json',
  );
  writeFileSync(target, serializeExploreCatalog());
  process.stdout.write(
    'Generated web Explore catalog from the API taxonomy.\n',
  );
}
