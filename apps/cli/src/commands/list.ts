/**
 * `tracepilot list` — enumerate sessions from ~/.copilot/session-state/
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import chalk from "chalk";

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

function getSessionStateDir(): string {
  return join(homedir(), ".copilot", "session-state");
}

async function discoverSessions(): Promise<SessionInfo[]> {
  const baseDir = getSessionStateDir();
  const entries = await readdir(baseDir, { withFileTypes: true });
  const sessions: SessionInfo[] = [];

  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  for (const entry of entries) {
    if (!entry.isDirectory() || !uuidPattern.test(entry.name)) continue;

    const sessionDir = join(baseDir, entry.name);
    const info: SessionInfo = {
      id: entry.name,
      hasEvents: false,
      hasDb: false,
    };

    // Read workspace.yaml
    try {
      const yaml = await readFile(join(sessionDir, "workspace.yaml"), "utf-8");
      // Simple YAML parsing for known fields (avoid full yaml dep for now)
      for (const line of yaml.split("\n")) {
        const match = line.match(/^(\w+):\s*(.+)/);
        if (!match) continue;
        const [, key, value] = match;
        const cleaned = value.replace(/^["']|["']$/g, "").trim();
        switch (key) {
          case "summary": info.summary = cleaned; break;
          case "repository": info.repository = cleaned; break;
          case "branch": info.branch = cleaned; break;
          case "created_at": info.createdAt = cleaned; break;
          case "updated_at": info.updatedAt = cleaned; break;
        }
      }
    } catch { /* no workspace.yaml */ }

    // Check for events and db
    try { await stat(join(sessionDir, "events.jsonl")); info.hasEvents = true; } catch {}
    try { await stat(join(sessionDir, "session.db")); info.hasDb = true; } catch {}

    sessions.push(info);
  }

  return sessions;
}

export async function listSessionsCommand(options: {
  limit: string;
  sort: string;
  json?: boolean;
}) {
  try {
    let sessions = await discoverSessions();

    // Sort
    sessions.sort((a, b) => {
      const dateA = a.updatedAt || a.createdAt || "";
      const dateB = b.updatedAt || b.createdAt || "";
      return dateB.localeCompare(dateA);
    });

    // Limit
    const limit = parseInt(options.limit, 10) || 20;
    sessions = sessions.slice(0, limit);

    if (options.json) {
      console.log(JSON.stringify(sessions, null, 2));
      return;
    }

    // Pretty print
    console.log(chalk.bold.blue(`\n  TracePilot — ${sessions.length} sessions\n`));
    for (const s of sessions) {
      const title = s.summary || chalk.dim("Untitled");
      const repo = s.repository ? chalk.cyan(s.repository) : "";
      const branch = s.branch ? chalk.green(s.branch) : "";
      const date = s.updatedAt
        ? chalk.dim(new Date(s.updatedAt).toLocaleDateString())
        : "";
      const indicators = [
        s.hasEvents ? "📝" : "",
        s.hasDb ? "🗄️" : "",
      ]
        .filter(Boolean)
        .join(" ");

      console.log(`  ${chalk.yellow(s.id.slice(0, 8))}  ${title}`);
      if (repo || branch) console.log(`           ${repo} ${branch}`);
      console.log(`           ${date} ${indicators}\n`);
    }
  } catch (err) {
    console.error(chalk.red("Failed to list sessions:"), err);
    process.exit(1);
  }
}
