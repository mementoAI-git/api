import {readFileSync} from 'fs';
import {resolve} from 'path';
import {describe, expect, it} from 'vitest';

const root = resolve(__dirname, '../..');

describe('deployment reliability gates', () => {
  it('does not run long migrations inside the PM2 listen deadline', () => {
    const source = readFileSync(resolve(root, 'src/index.ts'), 'utf8');
    expect(source).not.toContain('migrateUp');
  });

  it('exposes compiled production migration commands', () => {
    const pkg = JSON.parse(
      readFileSync(resolve(root, 'package.json'), 'utf8'),
    ) as {scripts: Record<string, string>};

    expect(pkg.scripts['migrations:up:prod']).toBe(
      'node build/src/migrations/run.js up',
    );
    expect(pkg.scripts['migrations:status:prod']).toBe(
      'node build/src/migrations/run.js status',
    );
  });

  it.each(['deploy-dev.yml', 'deploy-prod.yml'])(
    'allows legacy health only for rollback in %s',
    workflow => {
      const source = readFileSync(
        resolve(root, '.github/workflows', workflow),
        'utf8',
      );

      expect(source).toContain('${READINESS_URL%/ready}/health');
      expect(source).toContain('run_release_migrations');
      expect(source).toContain('migrations:up:prod');
      expect(source).toContain('return "$MIGRATION_STATUS"');
      expect(source).toMatch(
        /check_readiness "Rollback readiness check" \d+ 1/,
      );
      expect(source).toContain('[ "$READINESS_STATUS" = "404" ]');
      expect(source).toContain('[ "$READINESS_STATUS" = "405" ]');
      expect(source).not.toMatch(
        /check_readiness "(?:New release|Production) readiness check" \d+ 1/,
      );
      expect(source.indexOf('if ! run_release_migrations')).toBeLessThan(
        source.indexOf('if ! switch_release "$NEW_RELEASE"'),
      );
    },
  );
});
