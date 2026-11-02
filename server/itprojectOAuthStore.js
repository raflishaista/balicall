import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export function loadItProjectOAuthTokens(filePath) {
  if (!filePath) return null;
  try {
    const tokens = JSON.parse(readFileSync(filePath, 'utf8'));

    if (!tokens || typeof tokens !== 'object') return null;

    return {
      accessToken: typeof tokens.accessToken === 'string' ? tokens.accessToken : '',
      refreshToken: typeof tokens.refreshToken === 'string' ? tokens.refreshToken : '',
      expiresAt: Number.isFinite(Number(tokens.expiresAt))
        ? Number(tokens.expiresAt)
        : 0,
    };
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('[ITPROJECT] OAuth token file could not be read:', error.message);
    }
    return null;
  }
}

export function saveItProjectOAuthTokens(filePath, tokens) {
  mkdirSync(dirname(filePath), { recursive: true });

  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  const contents = JSON.stringify({
    accessToken: tokens.accessToken || '',
    refreshToken: tokens.refreshToken || '',
    expiresAt: Number(tokens.expiresAt) || 0,
    updatedAt: new Date().toISOString(),
  });

  try {
    writeFileSync(temporaryPath, contents, { flag: 'wx', mode: 0o600 });

    try {
      chmodSync(temporaryPath, 0o600);
    } catch {
      // Windows menggunakan ACL folder, bukan permission POSIX.
    }

    renameSync(temporaryPath, filePath);
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}