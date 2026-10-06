import {afterEach, describe, expect, it, vi} from 'vitest';
import {readFileSync} from 'fs';
import {resolve} from 'path';
import {runInNewContext} from 'vm';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('staging Pro configuration', () => {
  it.each([
    ['dev', 'production', 'true', true],
    ['dev', 'production', 'false', false],
    ['dev', 'production', '', false],
    ['prod', 'production', 'true', false],
    ['', 'production', 'true', false],
    ['', 'development', 'true', false],
  ])(
    'resolves deployment=%s runtime=%s flag=%s to %s',
    async (deployment, runtime, flag, expected) => {
      vi.stubEnv('MEMENTO_ENV', deployment);
      vi.stubEnv('NODE_ENV', runtime);
      vi.stubEnv('STAGING_AUTO_PRO', flag);
      const config = await import('../../src/utils/config');
      expect(config).toHaveProperty('STAGING_AUTO_PRO', expected);
    },
  );

  it.each([
    ['dev', undefined, 'true'],
    ['dev', 'false', 'false'],
    ['prod', 'true', 'false'],
  ])(
    'configures API and worker consistently for %s with flag %s',
    (deployment, flag, expected) => {
      const context = {
        process: {
          env: {MEMENTO_ENV: deployment, STAGING_AUTO_PRO: flag},
        },
        module: {exports: {} as {apps: Array<{env: Record<string, string>}>}},
        // The environment is supplied above; never load developer credentials.
        require: () => ({config: () => ({})}),
      };
      runInNewContext(
        readFileSync(resolve(__dirname, '../../ecosystem.config.js'), 'utf8'),
        context,
      );
      expect(context.module.exports.apps).toHaveLength(2);
      for (const app of context.module.exports.apps) {
        expect(app.env.STAGING_AUTO_PRO).toBe(expected);
      }
    },
  );
});
