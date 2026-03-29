import { existsSync, renameSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { config } from './config.js';

/**
 * Validate a channel session folder name.
 *
 * We allow nested relative paths (e.g. "guild/general") but reject empty,
 * absolute, and traversing paths so channel state always stays under
 * config.sessionsDir.
 */
export function validateSessionFolder(folder: string): string {
  const trimmed = folder.trim();
  if (!trimmed) {
    throw new Error('Session folder cannot be empty');
  }

  if (isAbsolute(trimmed)) {
    throw new Error(`Session folder must be relative: ${folder}`);
  }

  const segments = trimmed.split(/[\\/]+/);
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`Session folder contains an invalid path segment: ${folder}`);
  }

  return trimmed;
}

/** Resolve a channel session folder to an absolute directory under sessionsDir. */
export function resolveChannelSessionDir(folder: string): string {
  const safeFolder = validateSessionFolder(folder);
  const baseDir = resolve(config.sessionsDir);
  const sessionDir = resolve(baseDir, safeFolder);
  const rel = relative(baseDir, sessionDir);

  if (!rel || rel === '.' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Session folder escapes sessions directory: ${folder}`);
  }

  return sessionDir;
}

/** Rotate a channel session directory out of the active path without deleting it. */
export function rotateChannelSessionDir(folder: string): string | undefined {
  const sessionDir = resolveChannelSessionDir(folder);
  if (!existsSync(sessionDir)) {
    return undefined;
  }

  const parentDir = dirname(sessionDir);
  const sessionName = basename(sessionDir);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

  let archiveDir = resolve(parentDir, `${sessionName}__archived_${stamp}`);
  let suffix = 1;

  while (existsSync(archiveDir)) {
    archiveDir = resolve(parentDir, `${sessionName}__archived_${stamp}_${suffix}`);
    suffix += 1;
  }

  renameSync(sessionDir, archiveDir);
  return archiveDir;
}
