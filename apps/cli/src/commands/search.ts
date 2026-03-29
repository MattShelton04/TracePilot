/**
 * `tracepilot search <query>` — grep-style search through sessions.
 *
 * Searches workspace.yaml metadata and user messages in events.jsonl.
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import chalk from "chalk";
import { getSessionStateDir, parseWorkspace, streamEvents, fileExists } from "./utils.js";
import { UUID_REGEX } from "./utils.js";
import { wrapCommand, handleValidationError } from "../utils/errorHandler.js";

interface SearchHit {
  sessionId: string;
  summary?: string;
  repository?: string;
  branch?: string;
  matchSource: "metadata" | "message";
  snippet: string;
}

async function searchSessions(query: string): Promise<SearchHit[]> {
  const baseDir = getSessionStateDir();
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
      const haystack = [
        ws.summary,
        ws.repository,
        ws.branch,
        ws.cwd,
      ]
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
    } catch { /* no workspace */ }

    // Search user messages in events.jsonl
    if (!matched) {
      const eventsPath = join(sessionDir, "events.jsonl");
      if (await fileExists(eventsPath)) {
        try {
          let ws: { summary?: string; repository?: string; branch?: string } = {};
          try {
            ws = await parseWorkspace(sessionDir);
          } catch { /* ok */ }

          for await (const evt of streamEvents(eventsPath)) {
            if ((evt.type as string) === "user.message") {
              const content = ((evt.data as Record<string, unknown>)?.content as string) ?? "";
              if (content.toLowerCase().includes(q)) {
                // Extract snippet around match
                const idx = content.toLowerCase().indexOf(q);
                const start = Math.max(0, idx - 40);
                const end = Math.min(content.length, idx + query.length + 40);
                const snippet = (start > 0 ? "…" : "") +
                  content.slice(start, end).replace(/\n/g, " ") +
                  (end < content.length ? "…" : "");

                hits.push({
                  sessionId: entry.name,
                  summary: ws.summary,
                  repository: ws.repository,
                  branch: ws.branch,
                  matchSource: "message",
                  snippet,
                });
                break; // one hit per session is enough
              }
            }
          }
        } catch { /* skip */ }
      }
    }
  }

  return hits;
}

export async function searchCommand(
  query: string,
  options: { json?: boolean }
) {
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
      chalk.bold.blue(`\n  Search: "${query}" — ${hits.length} result${hits.length === 1 ? "" : "s"}\n`)
    );

    for (const h of hits) {
      const title = h.summary || chalk.dim("Untitled");
      const source = h.matchSource === "metadata"
        ? chalk.dim("[metadata]")
        : chalk.dim("[message]");
      console.log(`  ${chalk.yellow(h.sessionId.slice(0, 8))}  ${title}  ${source}`);
      if (h.repository) console.log(`           ${chalk.cyan(h.repository)}`);
      console.log(`           ${chalk.dim(h.snippet)}\n`);
    }
  }, "Search failed");
}
