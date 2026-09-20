/**
 * The usage range shared by the Agents explorer and the Skills manager.
 *
 * Bounds are inclusive `YYYY-MM-DD` in UTC because that is how the index
 * buckets a row's timestamp (`date(COALESCE(timestamp, session start))`).
 */
export type UsageRange = "30d" | "90d" | "all";

export const USAGE_RANGES: readonly { value: UsageRange; label: string }[] = [
  { value: "30d", label: "30d" },
  { value: "90d", label: "90d" },
  { value: "all", label: "All time" },
];

/** Long-form labels for prose, where "30d" reads as jargon. */
export const USAGE_RANGE_LABELS: Readonly<Record<UsageRange, string>> = {
  "30d": "30 days",
  "90d": "90 days",
  all: "all time",
};

const DAYS: Record<Exclude<UsageRange, "all">, number> = { "30d": 30, "90d": 90 };
const DAY_MS = 86_400_000;

/** Start of the range (UTC midnight), or `null` for all time. */
export function rangeStart(range: UsageRange, now: Date = new Date()): Date | null {
  if (range === "all") return null;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(today - (DAYS[range] - 1) * DAY_MS);
}

/** Inclusive `YYYY-MM-DD` bounds in UTC. `null` bounds mean unbounded. */
export function rangeBounds(
  range: UsageRange,
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
export function rangeDays(range: UsageRange, firstSeen: string | null, now = new Date()): string[] {
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

/**
 * Zero-fill a series of daily counts across the range, so a gap reads as "no
 * uses" rather than as a jump between the days that had some.
 */
export function zeroFilledDays(
  counts: readonly { date: string; uses: number }[],
  range: UsageRange,
  firstSeen: string | null,
  now = new Date(),
): number[] {
  if (counts.length === 0) return [];
  const byDate = new Map(counts.map((day) => [day.date, day.uses]));
  return rangeDays(range, firstSeen, now).map((date) => byDate.get(date) ?? 0);
}
