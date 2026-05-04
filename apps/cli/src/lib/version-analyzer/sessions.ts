import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import yaml from "js-yaml";
import { getSessionStateDir } from "../session-path.js";
import type { SessionExample, SessionVersionInfo } from "./types.js";

const MAX_FIELD_SCAN_LINE_CHARS = 1_000_000;
const FIELD_SCAN_SKIP_EVENTS = new Set(["session.import_legacy"]);

function collectFieldPaths(value: unknown, prefix = "", out: string[] = [], depth = 0): string[] {
  if (depth > 3 || value === null || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    out.push(path);
    if (child !== null && typeof child === "object") {
      if (Array.isArray(child)) {
        const firstObject = child.find((entry) => entry !== null && typeof entry === "object");
        if (firstObject) collectFieldPaths(firstObject, `${path}[]`, out, depth + 1);
      } else {
        collectFieldPaths(child, path, out, depth + 1);
      }
    }
  }
  return out;
}

export async function scanSessionVersions(maxSessions = 10000): Promise<SessionVersionInfo[]> {
  const sessionsDir = getSessionStateDir();
  if (!existsSync(sessionsDir)) return [];

  const sessionDirs = readdirSync(sessionsDir).filter((d) => {
    return /^[0-9a-f]{8}-/.test(d) && statSync(join(sessionsDir, d)).isDirectory();
  });

  const results: SessionVersionInfo[] = [];

  for (const dir of sessionDirs) {
    if (results.length >= maxSessions) break;

    const sessionPath = join(sessionsDir, dir);
    const eventsPath = join(sessionPath, "events.jsonl");
    if (!existsSync(eventsPath)) continue;

    let copilotVersion = "unknown";
    const eventTypesObserved = new Set<string>();
    const eventTypeCounts = new Map<string, number>();
    const eventFieldCounts = new Map<string, Map<string, number>>();

    // Stream events and collect schema-shape metadata. The report only stores
    // field paths/counts, not field values, so generated diagnostics stay safe.
    const typeRe = /"type"\s*:\s*"([^"]+)"/;
    try {
      const rl = createInterface({ input: createReadStream(eventsPath) });
      for await (const line of rl) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const typeMatch = typeRe.exec(trimmed);
        if (!typeMatch) continue;
        const eventType = typeMatch[1];
        eventTypesObserved.add(eventType);
        eventTypeCounts.set(eventType, (eventTypeCounts.get(eventType) ?? 0) + 1);

        const shouldParseForVersion =
          eventType === "session.start" ||
          (eventType === "session.resume" && copilotVersion === "unknown");
        const shouldScanFields =
          !FIELD_SCAN_SKIP_EVENTS.has(eventType) && trimmed.length <= MAX_FIELD_SCAN_LINE_CHARS;
        if (!shouldParseForVersion && !shouldScanFields) {
          continue;
        }

        try {
          const event = JSON.parse(trimmed) as Record<string, unknown>;
          const data = event.data as Record<string, unknown> | undefined;
          if (shouldParseForVersion && data?.copilotVersion) {
            copilotVersion = String(data.copilotVersion);
          }

          if (!shouldScanFields) {
            continue;
          }
          const fieldCounts = eventFieldCounts.get(eventType) ?? new Map<string, number>();
          for (const field of new Set(collectFieldPaths(data ?? {}))) {
            fieldCounts.set(field, (fieldCounts.get(field) ?? 0) + 1);
          }
          if (fieldCounts.size > 0) {
            eventFieldCounts.set(eventType, fieldCounts);
          }
        } catch {
          /* skip malformed fields; raw parser will catch malformed event lines elsewhere */
        }
      }
    } catch {
      /* skip unreadable files */
    }

    if (eventTypesObserved.size > 0) {
      // Defer workspace.yaml read until we know this session has useful data
      let summary: string | undefined;
      let createdAt: string | undefined;
      const workspacePath = join(sessionPath, "workspace.yaml");
      if (existsSync(workspacePath)) {
        try {
          const ws = yaml.load(readFileSync(workspacePath, "utf-8")) as Record<string, unknown>;
          summary = ws.summary as string | undefined;
          const ca = ws.created_at;
          createdAt = ca instanceof Date ? ca.toISOString() : (ca as string);
        } catch {
          /* ignore */
        }
      }

      results.push({
        sessionId: dir,
        copilotVersion,
        eventTypesObserved,
        eventTypeCounts,
        eventFieldCounts,
        createdAt,
        summary,
      });
    }
  }

  return results;
}

/**
 * Find sessions containing a specific event type.
 * Scans up to maxSessionsScanned sessions, returns up to maxResults matches.
 */
export async function findEventExamples(
  eventType: string,
  maxResults = 10,
  maxSessionsScanned = 10000,
): Promise<SessionExample[]> {
  const sessionsDir = getSessionStateDir();
  if (!existsSync(sessionsDir)) return [];

  const sessionDirs = readdirSync(sessionsDir).filter((d) => /^[0-9a-f]{8}-/.test(d));

  const results: SessionExample[] = [];
  let sessionsChecked = 0;

  for (const dir of sessionDirs) {
    if (results.length >= maxResults || sessionsChecked >= maxSessionsScanned) break;

    const eventsPath = join(sessionsDir, dir, "events.jsonl");
    if (!existsSync(eventsPath)) continue;
    sessionsChecked++;

    let found = false;
    let copilotVersion = "unknown";

    try {
      const rl = createInterface({ input: createReadStream(eventsPath) });
      for await (const line of rl) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const event = JSON.parse(trimmed) as Record<string, unknown>;
          const et = event.type as string;
          if (et === "session.start") {
            const data = event.data as Record<string, unknown> | undefined;
            if (data?.copilotVersion) copilotVersion = String(data.copilotVersion);
          }
          if (et === eventType) {
            found = true;
            rl.close();
            break;
          }
        } catch {
          /* skip */
        }
      }
    } catch {
      /* skip */
    }

    if (found) {
      // Get summary from workspace.yaml
      let summary: string | undefined;
      const workspacePath = join(sessionsDir, dir, "workspace.yaml");
      if (existsSync(workspacePath)) {
        try {
          const ws = yaml.load(readFileSync(workspacePath, "utf-8")) as Record<string, unknown>;
          summary = ws.summary as string | undefined;
        } catch {
          /* ignore */
        }
      }

      results.push({
        sessionId: dir,
        copilotVersion,
        summary,
      });
    }
  }

  return results;
}
