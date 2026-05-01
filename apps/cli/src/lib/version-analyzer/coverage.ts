import { TRACEPILOT_KNOWN_EVENTS } from "@tracepilot/types";
import { categorizeEvent } from "./event-categories.js";
import type {
  CopilotVersion,
  CoverageReport,
  EventObservation,
  SessionExample,
  SessionVersionInfo,
} from "./types.js";

export function computeCoverage(
  latestVersion: CopilotVersion,
  sessionInfo?: SessionVersionInfo[],
): CoverageReport {
  const knownSet = new Set(TRACEPILOT_KNOWN_EVENTS as readonly string[]);

  // Collect all observed event types across sessions
  const observedTypes = new Set<string>();
  const examplesByType = new Map<string, SessionExample[]>();
  if (sessionInfo) {
    for (const session of sessionInfo) {
      for (const et of session.eventTypesObserved) {
        observedTypes.add(et);
        if (!examplesByType.has(et)) examplesByType.set(et, []);
        // Safe: we just set the value above if it didn't exist
        const examples = examplesByType.get(et) ?? [];
        if (examples.length < 3) {
          examples.push({
            sessionId: session.sessionId,
            copilotVersion: session.copilotVersion,
            timestamp: session.createdAt,
            summary: session.summary,
          });
        }
      }
    }
  }

  const alwaysEphemeral = latestVersion.eventTypes.filter((e) => e.ephemeral === "always");
  const persistedEvents = latestVersion.eventTypes.filter((e) => e.ephemeral !== "always");
  const handled = persistedEvents.filter((e) => knownSet.has(e.name));
  const unhandled = persistedEvents.filter((e) => !knownSet.has(e.name));

  const observations: EventObservation[] = latestVersion.eventTypes.map((et) => {
    const isHandled = knownSet.has(et.name);
    const isObserved = observedTypes.has(et.name);
    const examples = examplesByType.get(et.name) ?? [];
    const category = categorizeEvent(et.name);

    let recommendation: string;
    if (isHandled) {
      recommendation = "✅ Already handled";
    } else if (et.ephemeral === "always") {
      recommendation = "👻 Always ephemeral — never stored in events.jsonl, no action needed";
    } else if (isObserved) {
      recommendation = "⚠️ Observed in sessions but not handled — consider adding typed support";
    } else {
      recommendation = "ℹ️ Defined in schema but not yet observed locally — monitor";
    }

    return {
      eventType: et.name,
      inSchema: true,
      ephemeral: et.ephemeral,
      handledByTracePilot: isHandled,
      observedLocally: isObserved,
      exampleSessions: examples,
      category,
      recommendation,
    };
  });

  const coveragePct =
    persistedEvents.length > 0
      ? Math.round((handled.length / persistedEvents.length) * 1000) / 10
      : 100;

  return {
    schemaVersion: latestVersion.version,
    totalSchemaEvents: latestVersion.eventTypes.length,
    alwaysEphemeralCount: alwaysEphemeral.length,
    persistedEventCount: persistedEvents.length,
    handledCount: handled.length,
    unhandledPersistedCount: unhandled.length,
    coveragePercentage: coveragePct,
    observations,
  };
}
