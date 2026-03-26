/**
 * `tracepilot list` — enumerate sessions from ~/.copilot/session-state/
 */

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import chalk from 'chalk';
import { fileExists, getSessionStateDir, parseWorkspace, UUID_REGEX } from './utils.js';

interface SessionInfo {
  id: string;
  summary?: string;
  repository?: string;
  branch?: string;
  createdAt?: string;
  updatedAt?: string;
  hasEvents: boolean;
  hasDb: boolean;
}

async function discoverSessions(): Promise<SessionInfo[]> {
  const baseDir = getSessionStateDir();
  const entries = await readdir(baseDir, { withFileTypes: true });
  const sessions: SessionInfo[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !UUID_REGEX.test(entry.name)) continue;

    const sessionDir = join(baseDir, entry.name);
    const info: SessionInfo = {
      id: entry.name,
      hasEvents: false,
      hasDb: false,
    };

    try {
      const ws = await parseWorkspace(sessionDir);
      info.summary = ws.summary;
      info.repository = ws.repository;
      info.branch = ws.branch;
      info.createdAt = ws.createdAt;
      info.updatedAt = ws.updatedAt;
    } catch {
      /* no workspace.yaml */
    }

    info.hasEvents = await fileExists(join(sessionDir, 'events.jsonl'));
    info.hasDb = await fileExists(join(sessionDir, 'session.db'));

    sessions.push(info);
  }

  return sessions;
}

export async function listSessionsCommand(options: {
  limit: string;
  sort: string;
  json?: boolean;
  repo?: string;
  branch?: string;
}) {
  try {
    let sessions = await discoverSessions();

    // Filters
    if (options.repo) {
      const r = options.repo.toLowerCase();
      sessions = sessions.filter((s) => s.repository?.toLowerCase().includes(r));
    }
    if (options.branch) {
      const b = options.branch.toLowerCase();
      sessions = sessions.filter((s) => s.branch?.toLowerCase().includes(b));
    }

    // Sort
    const validSorts = ['updated', 'created', 'name'] as const;
    const sortField = options.sort || 'updated';
    if (!validSorts.includes(sortField as (typeof validSorts)[number])) {
      console.error(
        chalk.red(
          `Invalid --sort value "${options.sort}". Must be one of: ${validSorts.join(', ')}`,
        ),
      );
      process.exit(1);
    }
    sessions.sort((a, b) => {
      if (sortField === 'name') {
        const nameA = (a.summary || '').toLowerCase();
        const nameB = (b.summary || '').toLowerCase();
        return nameA.localeCompare(nameB);
      }
      if (sortField === 'created') {
        const dateA = a.createdAt || '';
        const dateB = b.createdAt || '';
        return String(dateB).localeCompare(String(dateA));
      }
      // Default: "updated"
      const dateA = a.updatedAt || a.createdAt || '';
      const dateB = b.updatedAt || b.createdAt || '';
      return String(dateB).localeCompare(String(dateA));
    });

    // Limit
    const parsedLimit = parseInt(options.limit, 10);
    if (isNaN(parsedLimit) || parsedLimit < 1) {
      console.error(
        chalk.red(`Invalid --limit value "${options.limit}". Must be a positive integer.`),
      );
      process.exit(1);
    }
    const limit = parsedLimit;
    sessions = sessions.slice(0, limit);

    if (options.json) {
      console.log(JSON.stringify(sessions, null, 2));
      return;
    }

    // Pretty print
    console.log(chalk.bold.blue(`\n  TracePilot — ${sessions.length} sessions\n`));
    for (const s of sessions) {
      const title = s.summary || chalk.dim('Untitled');
      const repo = s.repository ? chalk.cyan(s.repository) : '';
      const branch = s.branch ? chalk.green(s.branch) : '';
      const date = s.updatedAt ? chalk.dim(new Date(s.updatedAt).toLocaleDateString()) : '';
      const indicators = [s.hasEvents ? '📝' : '', s.hasDb ? '🗄️' : ''].filter(Boolean).join(' ');

      console.log(`  ${chalk.yellow(s.id.slice(0, 8))}  ${title}`);
      if (repo || branch) console.log(`           ${repo} ${branch}`);
      console.log(`           ${date} ${indicators}\n`);
    }
  } catch (err) {
    console.error(chalk.red('Failed to list sessions:'), err);
    process.exit(1);
  }
}
