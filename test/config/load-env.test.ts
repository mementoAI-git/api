import {mkdtempSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';
import {afterEach, describe, expect, it} from 'vitest';
import {loadEnvFile} from '../../src/utils/load-env';

const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) {
    rmSync(folder, {recursive: true, force: true});
  }
});

function folderWithEnv(contents: string, name = '.env'): string {
  const folder = mkdtempSync(join(tmpdir(), 'memento-env-'));
  folders.push(folder);
  writeFileSync(join(folder, name), contents);
  return folder;
}

const FILE = [
  'MONGODB_URL=mongodb://frankfurt/memento_dev',
  'GEMINI_API_KEY=new-key',
  'PORT=3000',
  'NODE_ENV=development',
  'MEMENTO_ENV=prod',
  'STAGING_AUTO_PRO=false',
  'REDIS_URL=redis://localhost:6379',
].join('\n');

describe('loading .env', () => {
  it('under PM2, replaces values PM2 kept from an earlier start', () => {
    const env: Record<string, string | undefined> = {
      pm_id: '3',
      MONGODB_URL: 'mongodb://virginia/memento',
      GEMINI_API_KEY: 'old-key',
    };

    const result = loadEnvFile(env, folderWithEnv(FILE));

    expect(env.MONGODB_URL).toBe('mongodb://frankfurt/memento_dev');
    expect(env.GEMINI_API_KEY).toBe('new-key');
    expect(result.replaced.sort()).toEqual(['GEMINI_API_KEY', 'MONGODB_URL']);
  });

  it('under PM2, keeps the per-app values ecosystem.config.js sets', () => {
    const env: Record<string, string | undefined> = {
      pm_id: '3',
      PORT: '3001',
      NODE_ENV: 'production',
      MEMENTO_ENV: 'dev',
      STAGING_AUTO_PRO: 'true',
    };

    loadEnvFile(env, folderWithEnv(FILE));

    expect(env).toMatchObject({
      PORT: '3001',
      NODE_ENV: 'production',
      MEMENTO_ENV: 'dev',
      STAGING_AUTO_PRO: 'true',
    });
  });

  it('outside PM2, a value already in the environment wins (FOO=bar npm run …)', () => {
    const env: Record<string, string | undefined> = {
      GEMINI_API_KEY: 'from-the-command-line',
    };

    const result = loadEnvFile(env, folderWithEnv(FILE));

    expect(env.GEMINI_API_KEY).toBe('from-the-command-line');
    expect(result.replaced).toEqual([]);
  });

  it('fills in settings that are missing, everywhere', () => {
    const env: Record<string, string | undefined> = {pm_id: '0'};
    const result = loadEnvFile(env, folderWithEnv(FILE));
    expect(env.REDIS_URL).toBe('redis://localhost:6379');
    expect(result.loaded).toBeGreaterThan(0);
  });

  it('reads DOTENV_CONFIG_PATH when it is set, and does nothing without a file', () => {
    const folder = folderWithEnv(
      'GEMINI_API_KEY=from-custom-file',
      'custom.env',
    );
    const env: Record<string, string | undefined> = {
      DOTENV_CONFIG_PATH: join(folder, 'custom.env'),
    };
    loadEnvFile(env, '/nowhere');
    expect(env.GEMINI_API_KEY).toBe('from-custom-file');

    const empty: Record<string, string | undefined> = {};
    expect(loadEnvFile(empty, '/nowhere')).toEqual({loaded: 0, replaced: []});
  });
});
