// Deterministic timestamps keep tests and snapshots stable.
export const NOW = "2026-03-20T12:00:00.000Z";
export const NOW_MS = new Date(NOW).getTime();
export const ONE_HOUR = 3_600_000;

/** Offset NOW by `ms` milliseconds and return an ISO string. */
export function ts(ms: number): string {
  return new Date(NOW_MS + ms).toISOString();
}

/** Shared `eventsFileMtime` for mock freshness and timeline responses. */
export const MOCK_EVENTS_MTIME = 1_735_728_400_000;
