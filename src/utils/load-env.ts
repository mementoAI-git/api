import {existsSync, readFileSync} from 'fs';
import {resolve} from 'path';
import {parse} from 'dotenv';

/**
 * Loads `.env` (or DOTENV_CONFIG_PATH) into the environment. Imported first
 * by the API and worker entry points, before any setting is read.
 *
 * Under PM2 the file is the source of truth. PM2 keeps the environment an
 * app was first registered with and hands it to every restart and reload, so
 * a value changed in `.env` afterwards (a new database address, a rotated
 * key) would otherwise be silently ignored: dotenv never overrides a value
 * that is already set. The per-app values that ecosystem.config.js sets on
 * purpose still win, since dev and prod share that file.
 *
 * Everywhere else (local runs, tests, scripts) a value already in the
 * environment wins, so `FOO=bar npm run …` keeps working.
 */
export const PROCESS_MANAGER_KEYS = new Set([
  'NODE_ENV',
  'MEMENTO_ENV',
  'PORT',
  'STAGING_AUTO_PRO',
]);

type Environment = Record<string, string | undefined>;

export function loadEnvFile(
  env: Environment = process.env,
  cwd: string = process.cwd(),
): {loaded: number; replaced: string[]} {
  const path = resolve(cwd, env.DOTENV_CONFIG_PATH || '.env');
  if (!existsSync(path)) return {loaded: 0, replaced: []};
  const fromFile = parse(readFileSync(path));
  const underPm2 = env.pm_id !== undefined;
  const replaced: string[] = [];
  let loaded = 0;
  for (const [key, value] of Object.entries(fromFile)) {
    const current = env[key];
    if (current === undefined) {
      env[key] = value;
      loaded += 1;
    } else if (
      underPm2 &&
      current !== value &&
      !PROCESS_MANAGER_KEYS.has(key)
    ) {
      env[key] = value;
      replaced.push(key);
    }
  }
  return {loaded, replaced};
}

const result = loadEnvFile();
if (result.replaced.length) {
  // Names only: values can be secrets.
  console.info(
    `[env] .env replaced ${result.replaced.length} stale value(s) from the process manager: ${result.replaced.join(', ')}`,
  );
}
