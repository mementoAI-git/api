import path from 'node:path';

export type EngineConfig = {executable: string; modelDir: string};

export function photoSearchEnabled(): boolean {
  return process.env.MEMORY_SEARCH_PHOTOS_ENABLED !== 'false';
}

export function engineConfig(): EngineConfig | null {
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
