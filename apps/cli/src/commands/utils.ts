/**
 * Shared utilities for TracePilot CLI commands.
 */

import { createReadStream } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { formatTokens } from '@tracepilot/types';
import yaml from 'js-yaml';

// Re-export for convenience
export { formatTokens };

/** Regex to validate a full UUID (v4-style, case-insensitive). */
export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function getSessionStateDir(): string {
  return join(homedir(), '.copilot', 'session-state');
}

/**
 * Resolve a partial session ID to a full UUID.
 * Throws if zero or multiple matches.
 */
export async function findSession(partialId: string): Promise<string> {
  const baseDir = getSessionStateDir();
  const entries = await readdir(baseDir);
  const matches = entries.filter((e) => e.startsWith(partialId));
  if (matches.length === 0) throw new Error(`No session matching "${partialId}"`);
  if (matches.length > 1)
    throw new Error(
      `Ambiguous ID "${partialId}" — matches: ${matches.slice(0, 5).join(', ')}${matches.length > 5 ? ` (+${matches.length - 5} more)` : ''}`,
    );
  return matches[0];
}

export interface WorkspaceInfo {
  id?: string;
  cwd?: string;
  gitRoot?: string;
  repository?: string;
  hostType?: string;
  branch?: string;
  summary?: string;
  summaryCount?: number;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

/**
 * Parse workspace.yaml from a session directory using js-yaml.
 */
export async function parseWorkspace(sessionDir: string): Promise<WorkspaceInfo> {
  const content = await readFile(join(sessionDir, 'workspace.yaml'), 'utf-8');
  const raw = yaml.load(content) as Record<string, unknown>;

  // js-yaml parses dates as Date objects — normalize to ISO strings
  const toStr = (v: unknown): string | undefined => {
    if (v == null) return undefined;
    if (v instanceof Date) return v.toISOString();
    return String(v);
  };

  return {
    id: toStr(raw.id),
    cwd: toStr(raw.cwd),
    gitRoot: toStr(raw.git_root),
    repository: toStr(raw.repository),
    hostType: toStr(raw.host_type),
    branch: toStr(raw.branch),
    summary: toStr(raw.summary),
    summaryCount: raw.summary_count as number | undefined,
    createdAt: toStr(raw.created_at),
    updatedAt: toStr(raw.updated_at),
  };
}

/**
 * Stream events from an events.jsonl file line by line.
 */
export async function* streamEvents(filePath: string): AsyncGenerator<Record<string, unknown>> {
  const rl = createInterface({ input: createReadStream(filePath) });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      yield JSON.parse(trimmed);
    } catch {
      /* skip malformed lines */
    }
  }
}

/**
 * Check if a file exists.
 */
export async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
