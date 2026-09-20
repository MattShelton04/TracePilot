/** Usage ranges offered by the Agents explorer. */
export type AgentUsageRange = "30d" | "90d" | "all";

export const AGENT_USAGE_RANGES: readonly { value: AgentUsageRange; label: string }[] = [
  { value: "30d", label: "30d" },
  { value: "90d", label: "90d" },
  { value: "all", label: "All" },
];

const DAYS: Record<Exclude<AgentUsageRange, "all">, number> = { "30d": 30, "90d": 90 };
const DAY_MS = 86_400_000;

/** Start of the range (UTC midnight), or `null` for all time. */
export function rangeStart(range: AgentUsageRange, now: Date = new Date()): Date | null {
  if (range === "all") return null;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(today - (DAYS[range] - 1) * DAY_MS);
}

/**
 * Inclusive `YYYY-MM-DD` bounds in UTC, matching how the index buckets run
 * start times. `null` bounds mean unbounded.
 */
export function rangeBounds(
  range: AgentUsageRange,
  now: Date = new Date(),
): { fromDate: string | null; toDate: string | null } {
  const start = rangeStart(range, now);
  if (!start) return { fromDate: null, toDate: null };
  return {
    fromDate: start.toISOString().slice(0, 10),
    toDate: now.toISOString().slice(0, 10),
  };
}

/** Every date in the range, for zero-filled sparklines. */
export function rangeDays(
  range: AgentUsageRange,
  firstSeen: string | null,
  now = new Date(),
): string[] {
  const start = rangeStart(range, now) ?? (firstSeen ? new Date(firstSeen.slice(0, 10)) : null);
  if (!start || Number.isNaN(start.getTime())) return [];
  const days: string[] = [];
  const end = now.toISOString().slice(0, 10);
  for (let time = start.getTime(); days.length < 3660; time += DAY_MS) {
    const day = new Date(time).toISOString().slice(0, 10);
    days.push(day);
    if (day >= end) break;
  }
  return days;
}
