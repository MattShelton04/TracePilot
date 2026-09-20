import { describe, expect, it } from "vitest";
import type { SkillEntry, SkillFlag } from "../entries";
import { deriveSkillInsights } from "../insights";

function entry(name: string, flags: SkillFlag[], overrides: Partial<SkillEntry> = {}): SkillEntry {
  return {
    key: `dir/${name}`,
    name,
    description: "",
    kind: "installed",
    scope: "global",
    skill: null,
    usage: null,
    enabled: true,
    listingTokens: 500,
    flags,
    lastKnownPath: null,
    ...overrides,
  } as SkillEntry;
}

const idsOf = (insights: { id: string }[]) => insights.map((insight) => insight.id);

describe("deriveSkillInsights", () => {
  it("says nothing when there is nothing to act on", () => {
    expect(deriveSkillInsights([entry("clean", [])], "90 days")).toEqual([]);
  });

  it("totals the per-turn cost of unused skills and names the range", () => {
    const insights = deriveSkillInsights(
      [
        entry("a", ["unused"], { listingTokens: 800 }),
        entry("b", ["unused"], { listingTokens: 900 }),
      ],
      "30 days",
    );

    expect(insights).toHaveLength(1);
    expect(insights[0].text).toBe(
      "2 enabled skills unused in 30 days · about 1.7k tokens on every turn",
    );
    expect(insights[0].flag).toBe("unused");
    expect(insights[0].tone).toBe("warning");
  });

  it("keeps small token totals exact rather than rounding them to 0.5k", () => {
    const insights = deriveSkillInsights(
      [entry("a", ["unused"], { listingTokens: 420 })],
      "90 days",
    );
    expect(insights[0].text).toContain("about 420 tokens");
  });

  it("uses singular wording for a single skill and a single use", () => {
    const insights = deriveSkillInsights(
      [
        entry("solo", ["usedDisabled"], {
          enabled: false,
          usage: { uses: 1 } as SkillEntry["usage"],
        }),
      ],
      "90 days",
    );
    expect(insights[0].text).toBe("1 disabled skill still invoked 1 time in 90 days");
  });

  it("reports skills that ran but are not installed here", () => {
    const insights = deriveSkillInsights(
      [entry("gone", [], { kind: "missing", scope: "missing", skill: null })],
      "90 days",
    );
    expect(insights[0]).toMatchObject({ id: "missing", flag: "missing" });
    expect(insights[0].text).toBe("1 skill used in sessions is not installed here");
  });

  it("ranks the most actionable first, so a single-line caller shows that one", () => {
    const insights = deriveSkillInsights(
      [
        entry("d", ["drifted"]),
        entry("m", [], { kind: "missing", scope: "missing" }),
        entry("x", ["usedDisabled"], { enabled: false }),
        entry("u", ["unused"]),
      ],
      "90 days",
    );
    expect(idsOf(insights)).toEqual(["unused", "used-disabled", "missing", "drifted"]);
  });
});
