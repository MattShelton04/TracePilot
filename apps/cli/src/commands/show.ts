/**
 * `tracepilot show <session-id>` — display details for a specific session.
 *
 * Supports --turns, --metrics, --todos, --json flags.
 */

import { readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import chalk from "chalk";
import { wrapCommand } from "../utils/errorHandler.js";
import {
  fileExists,
  findSession,
  formatTokens,
  getSessionStateDir,
  parseWorkspace,
  streamEvents,
} from "./utils.js";

function getSessionDir(sessionId: string): string {
  return join(getSessionStateDir(), sessionId);
}

// ─── Turn reconstruction ────────────────────────────────────────────

interface TurnInfo {
  turnId: string;
  model?: string;
  userMessage?: string;
  assistantSnippet?: string;
  tools: { name: string; success: boolean }[];
  startTime?: string;
  endTime?: string;
  durationMs?: number;
}

async function reconstructTurns(eventsPath: string): Promise<TurnInfo[]> {
  const turns: TurnInfo[] = [];
  let currentTurn: TurnInfo | null = null;
  let pendingUserMessage: string | undefined;
  let lastAssignedUserMessage: string | undefined;
  // Track pending tool calls by toolCallId so we can match names on completion
  const pendingTools = new Map<string, string>(); // toolCallId → toolName

  function ensureCurrentTurn(
    data: Record<string, unknown> | undefined,
    timestamp?: string,
  ): TurnInfo {
    if (!currentTurn) {
      currentTurn = {
        turnId: (data?.turnId as string) ?? String(turns.length),
        tools: [],
        startTime: timestamp,
        userMessage:
          pendingUserMessage !== lastAssignedUserMessage ? pendingUserMessage : undefined,
      };
      if (pendingUserMessage) lastAssignedUserMessage = pendingUserMessage;
    }
    return currentTurn;
  }

  for await (const evt of streamEvents(eventsPath)) {
    const type = evt.type as string;
    const data = evt.data as Record<string, unknown> | undefined;
    const timestamp = evt.timestamp as string | undefined;

    if (type === "user.message") {
      const content = data?.content as string | undefined;
      if (content) {
        const clean = content.replace(/<[^>]+>[^<]*<\/[^>]+>/g, "").trim();
        pendingUserMessage = clean.slice(0, 200);
      }
    }

    if (type === "assistant.turn_start") {
      const userMsg =
        pendingUserMessage !== lastAssignedUserMessage ? pendingUserMessage : undefined;
      if (pendingUserMessage) lastAssignedUserMessage = pendingUserMessage;

      currentTurn = {
        turnId: (data?.turnId as string) ?? String(turns.length),
        tools: [],
        startTime: timestamp,
        userMessage: userMsg,
      };
    }

    if (type === "assistant.message") {
      const turn = ensureCurrentTurn(data, timestamp);
      const content = data?.content as string | undefined;
      if (content && content.length > 0 && !turn.assistantSnippet) {
        turn.assistantSnippet = content.slice(0, 120);
      }
    }

    if (type === "tool.execution_start") {
      const turn = ensureCurrentTurn(data, timestamp);
      const toolName = data?.toolName as string | undefined;
      const toolCallId = data?.toolCallId as string | undefined;
      const model = data?.model as string | undefined;
      if (model && !turn.model) turn.model = model;
      // Record the tool name keyed by toolCallId for later matching
      if (toolName && toolCallId) {
        pendingTools.set(toolCallId, toolName);
      }
      // Also add the tool entry now (will be updated on completion)
      if (toolName && toolName !== "report_intent") {
        turn.tools.push({ name: toolName, success: true });
      }
    }

    if (type === "tool.execution_complete") {
      const turn = ensureCurrentTurn(data, timestamp);
      const model = data?.model as string | undefined;
      if (model && !turn.model) turn.model = model;
      const toolCallId = data?.toolCallId as string | undefined;
      const success = data?.success as boolean | undefined;

      // Find the matching tool entry and update its success status
      if (toolCallId) {
        const toolName = pendingTools.get(toolCallId);
        if (toolName && toolName !== "report_intent") {
          // Find the last tool entry with this name and update success
          for (let j = turn.tools.length - 1; j >= 0; j--) {
            if (turn.tools[j].name === toolName) {
              if (success === false) turn.tools[j].success = false;
              break;
            }
          }
        }
        pendingTools.delete(toolCallId);
      }
    }

    if (type === "assistant.turn_end" && currentTurn) {
      currentTurn.endTime = timestamp;
      if (currentTurn.startTime && currentTurn.endTime) {
        currentTurn.durationMs =
          new Date(currentTurn.endTime).getTime() - new Date(currentTurn.startTime).getTime();
      }
      turns.push(currentTurn);
      currentTurn = null;
    }
  }

  // Push any incomplete turn
  if (currentTurn) turns.push(currentTurn);

  return turns;
}

function displayTurns(turns: TurnInfo[]) {
  console.log(chalk.bold.blue("\n  Conversation Turns\n"));
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    const dur = t.durationMs ? chalk.dim(`${(t.durationMs / 1000).toFixed(1)}s`) : "";
    const model = t.model ? chalk.magenta(`[${t.model}]`) : "";
    console.log(`  ${chalk.bold(`Turn ${i}`)}  ${model}  ${dur}`);

    if (t.userMessage) {
      console.log(`    ${chalk.cyan("User:")} ${t.userMessage}`);
    }
    if (t.assistantSnippet) {
      console.log(
        `    ${chalk.green("Assistant:")} ${t.assistantSnippet}${t.assistantSnippet.length >= 120 ? "…" : ""}`,
      );
    }
    if (t.tools.length > 0) {
      // Deduplicate tool names, show counts
      const toolMap = new Map<string, { ok: number; fail: number }>();
      for (const tool of t.tools) {
        const entry = toolMap.get(tool.name) ?? { ok: 0, fail: 0 };
        if (tool.success) entry.ok++;
        else entry.fail++;
        toolMap.set(tool.name, entry);
      }
      const parts = [...toolMap.entries()].map(([name, counts]) => {
        const label =
          counts.fail > 0
            ? `${name} (${chalk.green("✓")}${counts.ok} ${chalk.red("✗")}${counts.fail})`
            : `${name} (${chalk.green("✓")})`;
        return label;
      });
      console.log(`    ${chalk.dim("Tools:")} ${parts.join(", ")}`);
    }
    console.log();
  }
}

// ─── Shutdown metrics ───────────────────────────────────────────────

interface ShutdownMetrics {
  shutdownType?: string;
  totalPremiumRequests?: number;
  totalApiDurationMs?: number;
  sessionStartTime?: number;
  currentModel?: string;
  codeChanges?: {
    linesAdded?: number;
    linesRemoved?: number;
    filesModified?: string[];
  };
  modelMetrics?: Record<
    string,
    {
      requests?: { count?: number; cost?: number };
      usage?: {
        inputTokens?: number;
        outputTokens?: number;
        cacheReadTokens?: number;
        cacheWriteTokens?: number;
      };
    }
  >;
}

async function getShutdownMetrics(eventsPath: string): Promise<ShutdownMetrics | null> {
  let last: ShutdownMetrics | null = null;
  for await (const evt of streamEvents(eventsPath)) {
    if ((evt.type as string) === "session.shutdown") {
      last = evt.data as ShutdownMetrics;
    }
  }
  return last;
}

function displayMetrics(m: ShutdownMetrics) {
  console.log(chalk.bold.blue("\n  Shutdown Metrics\n"));
  if (m.shutdownType) console.log(`    ${chalk.dim("Type:")} ${m.shutdownType}`);
  if (m.currentModel) console.log(`    ${chalk.dim("Model:")} ${m.currentModel}`);
  if (m.totalPremiumRequests != null)
    console.log(`    ${chalk.dim("Premium requests:")} ${m.totalPremiumRequests}`);
  if (m.totalApiDurationMs != null)
    console.log(`    ${chalk.dim("API duration:")} ${(m.totalApiDurationMs / 1000).toFixed(1)}s`);

  if (m.codeChanges) {
    const c = m.codeChanges;
    const files = c.filesModified?.length ?? 0;
    console.log(
      `    ${chalk.dim("Code changes:")} ${chalk.green(`+${c.linesAdded ?? 0}`)} ${chalk.red(`-${c.linesRemoved ?? 0}`)} (${files} files)`,
    );
  }

  if (m.modelMetrics && Object.keys(m.modelMetrics).length > 0) {
    console.log(`\n    ${chalk.bold("Model Usage:")}`);
    for (const [model, info] of Object.entries(m.modelMetrics)) {
      const reqs = info.requests?.count ?? 0;
      const input = formatTokens(info.usage?.inputTokens ?? 0);
      const output = formatTokens(info.usage?.outputTokens ?? 0);
      console.log(
        `      ${chalk.cyan(model.padEnd(28))} requests: ${String(reqs).padEnd(4)} input: ${input.padEnd(8)} output: ${output}`,
      );
    }
  }
  console.log();
}

// ─── Todos ──────────────────────────────────────────────────────────

interface TodoItem {
  id: string;
  title: string;
  description?: string;
  status: string;
  deps: string[];
}

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

function displayTodos(todos: TodoItem[]) {
  console.log(chalk.bold.blue(`\n  Todos (${todos.length} items)\n`));
  for (const t of todos) {
    let icon: string;
    let statusLabel = "";
    switch (t.status) {
      case "done":
        icon = chalk.green("✓");
        break;
      case "in_progress":
        icon = chalk.yellow("●");
        statusLabel = chalk.yellow(" [in_progress]");
        break;
      case "blocked":
        icon = chalk.red("✗");
        statusLabel = chalk.red(` [blocked${t.deps.length ? " by " + t.deps.join(", ") : ""}]`);
        break;
      default:
        icon = chalk.dim("○");
        break;
    }
    const idStr = chalk.dim(t.id.padEnd(20));
    console.log(`    ${icon} ${idStr} ${t.title}${statusLabel}`);
  }
  console.log();
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
            console.log(`  ${chalk.dim(key + ":")} ${val}`);
          }
        }
        console.log();
      }
    }

    // ── Turns ──
    if (options.turns) {
      if (await fileExists(eventsPath)) {
        const turns = await reconstructTurns(eventsPath);
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
      console.log(JSON.stringify(jsonOutput, null, 2));
    }
  }, "Failed to show session");
}
