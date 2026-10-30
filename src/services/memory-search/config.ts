import path from 'node:path';

/** DigUp spawned on this machine for each request (reloads the model). */
export type LocalEngineConfig = {executable: string; modelDir: string};
/** The embedding server on the private network, with the model kept loaded. */
export type RemoteEngineConfig = {url: string; token: string};
export type EngineConfig = LocalEngineConfig | RemoteEngineConfig;

export function photoSearchEnabled(): boolean {
  return process.env.MEMORY_SEARCH_PHOTOS_ENABLED !== 'false';
}

/** The embedding server when configured, else a local helper, else none. */
export function engineConfig(): EngineConfig | null {
  const url = (process.env.MEMORY_SEARCH_ENGINE_URL || '').replace(/\/+$/, '');
  const token = process.env.MEMORY_SEARCH_ENGINE_TOKEN || '';
  if (url) {
    return /^https?:\/\/[^/]+$/.test(url) && token.length >= 32
      ? {url, token}
      : null;
  }
  const executable = process.env.MEMORY_SEARCH_DIGUP_PATH || '';
  const modelDir = process.env.MEMORY_SEARCH_MODELS_DIR || '';
  return path.isAbsolute(executable) && path.isAbsolute(modelDir)
    ? {executable, modelDir}
    : null;
}

export function searchPilotEnabled(userId: string): boolean {
  const users = (process.env.MEMORY_SEARCH_USER_IDS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  return (
    process.env.MEMORY_SEARCH_ENABLED === 'true' &&
    users.includes(userId) &&
    Boolean(engineConfig())
  );
}
