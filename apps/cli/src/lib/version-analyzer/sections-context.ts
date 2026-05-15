/**
 * Shared types and aggregation helpers used by the version-analyzer report
 * section renderers in `./sections.ts`.
 */

import type {
  CopilotVersion,
  CoverageReport,
  ReportOptions,
  SessionVersionInfo,
  VersionDiff,
} from "./types.js";

export interface ObservedEventStat {
  count: number;
  sessions: number;
  fields: Map<string, number>;
}

/** Aggregate per-event-type observation counts across all scanned sessions. */
export function aggregateObservedStats(
  sessionInfo: SessionVersionInfo[],
): Map<string, ObservedEventStat> {
  const stats = new Map<string, ObservedEventStat>();
  for (const session of sessionInfo) {
    for (const [eventType, count] of session.eventTypeCounts) {
      const stat = stats.get(eventType) ?? {
        count: 0,
        sessions: 0,
        fields: new Map<string, number>(),
      };
      stat.count += count;
      stat.sessions += 1;
      const fields = session.eventFieldCounts.get(eventType);
      if (fields) {
        for (const [field, fieldCount] of fields) {
          stat.fields.set(field, (stat.fields.get(field) ?? 0) + fieldCount);
        }
      }
      stats.set(eventType, stat);
    }
  }
  return stats;
}

export function collectAddedEvents(diffs: VersionDiff[]): string[] {
  return [...new Set(diffs.flatMap((diff) => diff.addedEvents))].sort();
}

export function collectInterestingEvents(diffs: VersionDiff[], coverage: CoverageReport): string[] {
  const events = new Set<string>();
  for (const diff of diffs) {
    for (const eventType of diff.addedEvents) events.add(eventType);
    for (const modification of diff.modifiedEvents) events.add(modification.eventType);
  }
  for (const observation of coverage.observations) {
    if (!observation.handledByTracePilot && observation.ephemeral !== "always") {
      events.add(observation.eventType);
    }
  }
  return [...events].sort();
}

export function valueAddForEvent(eventType: string): string {
  const notes: Record<string, string> = {
    "assistant.message_start":
      "earlier live message/phase boundaries before final assistant messages are persisted.",
    "model.call_failure":
      "model reliability diagnostics, provider failure attribution, and retry/fallback explanations.",
    "auto_mode_switch.requested":
      "visibility into why Copilot requested an automatic model/mode fallback.",
    "auto_mode_switch.completed": "visibility into the outcome of automatic model/mode fallback.",
  };
  return notes[eventType] ?? "potential live-session telemetry for future UI enrichment.";
}

/** Shared context bundle passed to each section renderer. */
export interface ReportContext {
  versions: CopilotVersion[];
  diffs: VersionDiff[];
  coverage: CoverageReport;
  sessionInfo: SessionVersionInfo[];
  options: ReportOptions;
  empiricalStats: Map<string, ObservedEventStat>;
  schemaEvents: Map<string, CopilotVersion["eventTypes"][number]>;
  unknownObserved: string[];
}
