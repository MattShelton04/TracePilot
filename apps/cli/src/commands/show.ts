/**
 * `tracepilot show <session-id>` — display details for a specific session.
 *
 * Supports --turns, --metrics, --todos, --json flags.
 */

import { readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import chalk from "chalk";
import { reconstructTurns } from "../lib/turnReconstruction.js";
import { wrapCommand } from "../utils/errorHandler.js";
import {
  displayMetrics,
  displayTodos,
  displayTurns,
  type ShutdownMetrics,
  type TodoItem,
} from "./show-display.js";
import {
  fileExists,
  findSession,
  getSessionStateDir,
  parseWorkspace,
  printJson,
  streamEvents,
} from "./utils.js";

function getSessionDir(sessionId: string): string {
  return join(getSessionStateDir(), sessionId);
}

// ─── Shutdown metrics ───────────────────────────────────────────────

async function getShutdownMetrics(eventsPath: string): Promise<ShutdownMetrics | null> {
  let last: ShutdownMetrics | null = null;
  for await (const evt of streamEvents(eventsPath)) {
    if ((evt.type as string) === "session.shutdown") {
      last = evt.data as ShutdownMetrics;
    }
  }
  return last;
}

// ─── Todos ──────────────────────────────────────────────────────────

function loadTodos(dbPath: string): TodoItem[] {
  // better-sqlite3 is a CJS native addon — use createRequire in ESM
  const require = createRequire(import.meta.url);
  const Database = require("better-sqlite3");
  const db = new Database(dbPath, { readonly: true });
  try {
    const todos = db
      .prepare("SELECT id, title, description, status FROM todos ORDER BY created_at")
      .all() as Array<{ id: string; title: string; description: string | null; status: string }>;

    const deps = db.prepare("SELECT todo_id, depends_on FROM todo_deps").all() as Array<{
      todo_id: string;
      depends_on: string;
    }>;

    const depMap = new Map<string, string[]>();
    for (const d of deps) {
      const arr = depMap.get(d.todo_id) ?? [];
      arr.push(d.depends_on);
      depMap.set(d.todo_id, arr);
    }

    return todos.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description ?? undefined,
      status: t.status,
      deps: depMap.get(t.id) ?? [],
    }));
  } finally {
    db.close();
  }
}

// ─── Main show command ──────────────────────────────────────────────

export async function showSessionCommand(
  sessionIdArg: string,
  options: { turns?: boolean; metrics?: boolean; todos?: boolean; json?: boolean },
) {
  return wrapCommand(async () => {
    const sessionId = await findSession(sessionIdArg);
    const dir = getSessionDir(sessionId);
    const eventsPath = join(dir, "events.jsonl");
    const dbPath = join(dir, "session.db");

    const jsonOutput: Record<string, unknown> = {};

    // ── Workspace info ──
    let workspace: Record<string, unknown> | undefined;
    try {
      workspace = await parseWorkspace(dir);
    } catch {
      /* no workspace.yaml */
    }

    if (options.json) {
      jsonOutput.sessionId = sessionId;
      jsonOutput.workspace = workspace ?? null;
    } else if (!options.turns && !options.metrics && !options.todos) {
      // Default overview
      console.log(chalk.bold.blue(`\n  Session: ${sessionId}\n`));
      if (workspace) {
        for (const [key, val] of Object.entries(workspace)) {
          if (val != null && val !== "") {
            console.log(`  ${chalk.dim(`${key}:`)} ${val}`);
          }
        }
        console.log();
      }
    }

    // ── Turns ──
    if (options.turns) {
      if (await fileExists(eventsPath)) {
        const turns = await reconstructTurns(streamEvents(eventsPath));
        if (options.json) {
          jsonOutput.turns = turns;
        } else {
          displayTurns(turns);
        }
      } else if (!options.json) {
        console.log(chalk.dim("  (no events.jsonl)\n"));
      }
    }

    // ── Metrics ──
    if (options.metrics) {
      if (await fileExists(eventsPath)) {
        const m = await getShutdownMetrics(eventsPath);
        if (m) {
          if (options.json) {
            jsonOutput.metrics = m;
          } else {
            displayMetrics(m);
          }
        } else if (!options.json) {
          console.log(chalk.dim("  (no shutdown event found)\n"));
        }
      } else if (!options.json) {
        console.log(chalk.dim("  (no events.jsonl)\n"));
      }
    }

    // ── Todos ──
    if (options.todos) {
      if (await fileExists(dbPath)) {
        try {
          const todos = loadTodos(dbPath);
          if (options.json) {
            jsonOutput.todos = todos;
          } else {
            displayTodos(todos);
          }
        } catch (err) {
          if (!options.json) {
            console.log(chalk.dim(`  (could not read session.db: ${err})\n`));
          }
        }
      } else if (!options.json) {
        console.log(chalk.dim("  (no session.db)\n"));
      }
    }

    // ── Default: event summary + file list ──
    if (!options.turns && !options.metrics && !options.todos) {
      if (await fileExists(eventsPath)) {
        const typeCounts = new Map<string, number>();
        for await (const evt of streamEvents(eventsPath)) {
          const t = (evt.type as string) || "unknown";
          typeCounts.set(t, (typeCounts.get(t) || 0) + 1);
        }
        const total = [...typeCounts.values()].reduce((a, b) => a + b, 0);

        if (options.json) {
          jsonOutput.eventCounts = Object.fromEntries(typeCounts);
        } else {
          console.log(`  ${chalk.cyan("Events:")} ${total}`);
          for (const [type, count] of [...typeCounts.entries()].sort((a, b) => b[1] - a[1])) {
            console.log(`    ${chalk.dim(type)}: ${count}`);
          }
          console.log();
        }
      } else if (!options.json) {
        console.log(chalk.dim("  (no events.jsonl)\n"));
      }

      // List files
      const files = await readdir(dir);
      if (options.json) {
        jsonOutput.files = files;
      } else {
        console.log(`  ${chalk.cyan("Files:")} ${files.join(", ")}\n`);
      }
    }

    // ── JSON output ──
    if (options.json) {
      printJson(jsonOutput);
    }
  }, "Failed to show session");
}
