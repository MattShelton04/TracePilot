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
  requireSessionStateDir,
  streamEvents,
  UUID_REGEX,
} from "./utils.js";

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

export async function searchSessions(query: string): Promise<SearchHit[]> {
  const baseDir = await requireSessionStateDir();
  const entries = await readdir(baseDir, { withFileTypes: true });
  const hits: SearchHit[] = [];
  const q = query.toLowerCase();

  for (const entry of entries) {
    if (!entry.isDirectory() || !UUID_REGEX.test(entry.name)) continue;
    const sessionDir = join(baseDir, entry.name);
    let matched = false;

    // Search workspace.yaml
    try {
      const ws = await parseWorkspace(sessionDir);
      const haystack = [ws.summary, ws.repository, ws.branch, ws.cwd]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      if (haystack.includes(q)) {
        hits.push({
          sessionId: entry.name,
          summary: ws.summary,
          repository: ws.repository,
          branch: ws.branch,
          matchSource: "metadata",
          snippet: ws.summary ?? ws.repository ?? "(metadata match)",
        });
        matched = true;
      }
    } catch {
      /* no workspace */
    }

    // Search conversation/tool content in events.jsonl
    if (!matched) {
      const eventsPath = join(sessionDir, "events.jsonl");
      if (await fileExists(eventsPath)) {
        try {
          let ws: { summary?: string; repository?: string; branch?: string } = {};
          try {
            ws = await parseWorkspace(sessionDir);
          } catch {
            /* ok */
          }

          for await (const evt of streamEvents(eventsPath)) {
            const { texts, source } = extractEventTexts(evt);
            for (const text of texts) {
              const haystack = text.toLowerCase();
              if (!haystack.includes(q)) continue;

              hits.push({
                sessionId: entry.name,
                summary: ws.summary,
                repository: ws.repository,
                branch: ws.branch,
                matchSource: source,
                snippet: buildSnippet(text, q),
              });
              matched = true;
              break;
            }
            if (matched) break; // one hit per session is enough
          }
        } catch {
          /* skip */
        }
      }
    }
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
      console.log(JSON.stringify(hits, null, 2));
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
