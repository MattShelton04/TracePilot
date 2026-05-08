/**
 * `tracepilot search <query>` — grep-style search through sessions.
 *
 * Searches workspace.yaml metadata and user messages in events.jsonl.
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import chalk from "chalk";
import { handleValidationError, wrapCommand } from "../utils/errorHandler.js";
import {
  fileExists,
  parseWorkspace,
  printJson,
  requireSessionStateDir,
  streamEvents,
  UUID_REGEX,
  type WorkspaceInfo,
} from "./utils.js";

/**
 * Concurrency cap for parallel session scans. Chosen to amortise I/O wait
 * without exhausting the file-descriptor budget on large session corpora.
 */
const SEARCH_CONCURRENCY = 8;

type MatchSource = "metadata" | "user" | "assistant" | "tool";

export interface SearchHit {
  sessionId: string;
  summary?: string;
  repository?: string;
  branch?: string;
  matchSource: MatchSource;
  snippet: string;
}

function buildSnippet(text: string, queryLower: string): string {
  const lower = text.toLowerCase();
  const idx = lower.indexOf(queryLower);
  if (idx === -1) return text;

  const start = Math.max(0, idx - 40);
  const end = Math.min(text.length, idx + queryLower.length + 40);
  const snippet = text.slice(start, end).replace(/\s+/g, " ");
  return `${start > 0 ? "…" : ""}${snippet}${end < text.length ? "…" : ""}`;
}

function extractEventTexts(evt: Record<string, unknown>): { texts: string[]; source: MatchSource } {
  const type =
    (typeof evt.type === "string" && evt.type) ||
    (typeof (evt as Record<string, unknown>).eventType === "string" &&
      ((evt as Record<string, unknown>).eventType as string)) ||
    "";
  const data = (evt.data ?? {}) as Record<string, unknown>;
  const texts: string[] = [];

  const add = (value: unknown) => {
    if (typeof value === "string" && value.trim()) {
      texts.push(value);
    } else if (value != null && typeof value === "object") {
      const json = JSON.stringify(value);
      if (json.length > 2) texts.push(json);
    }
  };

  if (type.startsWith("user.")) {
    add(data.content);
    return { texts, source: "user" };
  }

  if (type.startsWith("assistant.")) {
    add(data.content);
    // Some assistant events include a messages array with content fields
    if (Array.isArray(data.messages)) {
      for (const msg of data.messages) {
        if (typeof msg === "string") add(msg);
        else if (msg && typeof msg === "object") add((msg as Record<string, unknown>).content);
      }
    }
    return { texts, source: "assistant" };
  }

  if (type.startsWith("tool.")) {
    add(data.content);
    add(data.result);
    add(data.output);
    add(data.error);
    return { texts, source: "tool" };
  }

  return { texts: [], source: "user" };
}

/**
 * Scan a single session directory for the first matching hit.
 *
 * Mirrors the legacy sequential semantics: metadata is searched first, and
 * `events.jsonl` is only scanned if metadata did not match. The previously
 * duplicated `parseWorkspace` call has been collapsed so the file is parsed
 * at most once per session. Errors are swallowed (per-session failures must
 * not abort the whole search), matching the original try/catch behaviour.
 */
async function scanSession(
  baseDir: string,
  sessionId: string,
  q: string,
): Promise<SearchHit | null> {
  const sessionDir = join(baseDir, sessionId);

  let ws: WorkspaceInfo | null = null;
  try {
    ws = await parseWorkspace(sessionDir);
  } catch {
    /* no workspace — leave ws as null */
  }

  if (ws) {
    const haystack = [ws.summary, ws.repository, ws.branch, ws.cwd]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    if (haystack.includes(q)) {
      return {
        sessionId,
        summary: ws.summary,
        repository: ws.repository,
        branch: ws.branch,
        matchSource: "metadata",
        snippet: ws.summary ?? ws.repository ?? "(metadata match)",
      };
    }
  }

  const eventsPath = join(sessionDir, "events.jsonl");
  if (!(await fileExists(eventsPath))) return null;

  try {
    for await (const evt of streamEvents(eventsPath)) {
      const { texts, source } = extractEventTexts(evt);
      for (const text of texts) {
        if (!text.toLowerCase().includes(q)) continue;
        return {
          sessionId,
          summary: ws?.summary,
          repository: ws?.repository,
          branch: ws?.branch,
          matchSource: source,
          snippet: buildSnippet(text, q),
        };
      }
    }
  } catch {
    /* skip malformed/unreadable events */
  }

  return null;
}

/**
 * Run `tasks` with bounded concurrency and return results in input order.
 *
 * Uses `Promise.allSettled` semantics under the hood: a rejected task does
 * not abort siblings — it simply resolves to `null` so the search can
 * continue across the remaining sessions.
 */
async function runWithConcurrency<T>(
  tasks: ReadonlyArray<() => Promise<T | null>>,
  limit: number,
): Promise<Array<T | null>> {
  const results: Array<T | null> = new Array(tasks.length).fill(null);
  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      const idx = cursor++;
      if (idx >= tasks.length) return;
      try {
        results[idx] = await tasks[idx]();
      } catch {
        results[idx] = null;
      }
    }
  };

  const poolSize = Math.min(limit, tasks.length);
  const workers: Promise<void>[] = [];
  for (let i = 0; i < poolSize; i++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

export async function searchSessions(query: string): Promise<SearchHit[]> {
  const baseDir = await requireSessionStateDir();
  const entries = await readdir(baseDir, { withFileTypes: true });
  const q = query.toLowerCase();

  const sessionIds = entries
    .filter((e) => e.isDirectory() && UUID_REGEX.test(e.name))
    .map((e) => e.name);

  const tasks = sessionIds.map((id) => () => scanSession(baseDir, id, q));
  const settled = await runWithConcurrency(tasks, SEARCH_CONCURRENCY);

  const hits: SearchHit[] = [];
  for (const hit of settled) {
    if (hit) hits.push(hit);
  }
  return hits;
}

export async function searchCommand(query: string, options: { json?: boolean }) {
  if (!query.trim()) {
    handleValidationError("Search query cannot be empty.");
  }

  return wrapCommand(async () => {
    const hits = await searchSessions(query);

    if (options.json) {
      printJson(hits);
      return;
    }

    if (hits.length === 0) {
      console.log(chalk.dim(`\n  No sessions matching "${query}"\n`));
      return;
    }

    console.log(
      chalk.bold.blue(
        `\n  Search: "${query}" — ${hits.length} result${hits.length === 1 ? "" : "s"}\n`,
      ),
    );

    for (const h of hits) {
      const title = h.summary || chalk.dim("Untitled");
      const sourceLabel =
        h.matchSource === "metadata"
          ? "[metadata]"
          : h.matchSource === "user"
            ? "[user]"
            : h.matchSource === "assistant"
              ? "[assistant]"
              : "[tool]";
      const source = chalk.dim(sourceLabel);
      console.log(`  ${chalk.yellow(h.sessionId.slice(0, 8))}  ${title}  ${source}`);
      if (h.repository) console.log(`           ${chalk.cyan(h.repository)}`);
      console.log(`           ${chalk.dim(h.snippet)}\n`);
    }
  }, "Search failed");
}
