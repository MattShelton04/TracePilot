import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dashboardDays } from "@/utils/analyticsDashboard";
import { presetRange } from "@/utils/analyticsFilters";
import { rangeBounds } from "@/utils/usage/range";
import { FIXTURE_ANALYTICS } from "../../__tests__/views/analyticsFixtures";

const DAY_MS = 86_400_000;
const PRESETS = [
  ["7d", 7],
  ["30d", 30],
  ["90d", 90],
] as const;

/** UTC days from `fromDate` through today (UTC), inclusive. */
function utcDaysCovered(fromDate: string, now: Date): number {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return (today - Date.parse(`${fromDate}T00:00:00Z`)) / DAY_MS + 1;
}

describe("presetRange", () => {
  const originalTz = process.env.TZ;

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    process.env.TZ = originalTz;
  });

  // The index buckets by UTC day, so a preset must start the same UTC day
  // wherever the user is. Each clock is one where local and UTC dates differ.
  it.each([
    ["UTC", "2026-10-14T12:00:00Z"],
    ["America/Los_Angeles", "2026-10-15T03:00:00Z"], // still Oct 14, 20:00 locally
    ["Pacific/Auckland", "2026-10-14T20:00:00Z"], // already Oct 15, 09:00 locally
  ])("covers exactly N UTC days in %s", (tz, iso) => {
    process.env.TZ = tz;
    const now = new Date(iso);
    vi.setSystemTime(now);
    for (const [preset, days] of PRESETS) {
      const { fromDate } = presetRange(preset);
      expect(fromDate, `${preset} in ${tz}`).toBeDefined();
      expect(utcDaysCovered(fromDate as string, now), `${preset} in ${tz}`).toBe(days);
      // The dashboard's day axis draws the same span.
      const drawn = dashboardDays(FIXTURE_ANALYTICS, { fromDate }, now);
      expect(drawn, `${preset} in ${tz}`).toHaveLength(days);
    }
  });

  it("starts where the Agents and Skills range does", () => {
    process.env.TZ = "America/Los_Angeles";
    const now = new Date("2026-10-15T03:00:00Z");
    vi.setSystemTime(now);
    expect(presetRange("30d").fromDate).toBe(rangeBounds("30d", now).fromDate);
    expect(presetRange("90d").fromDate).toBe(rangeBounds("90d", now).fromDate);
    expect(presetRange("7d")).toEqual({ fromDate: "2026-10-09" });
  });

  it("starts This Month on the first UTC day and leaves All Time open", () => {
    process.env.TZ = "Pacific/Auckland";
    vi.setSystemTime(new Date("2026-09-30T20:00:00Z")); // Oct 1 locally
    expect(presetRange("month-to-date")).toEqual({ fromDate: "2026-09-01" });
    expect(presetRange("all")).toEqual({});
  });
});
