// biome-ignore-all assist/source/organizeImports: setup must register mocks before the store import.
import { flushPromises } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ALL_SUMMARIES, mocks, setupSkillsStoreTest, usageStats } from "./setup";
import { useSkillsStore } from "../../../stores/skills";

setupSkillsStoreTest();

beforeEach(() => localStorage.clear());

function summaryOf(skills: ReturnType<typeof usageStats>[]) {
  return {
    totalUses: skills.reduce((sum, stats) => sum + stats.uses, 0),
    totalSessions: 4,
    unknownTriggerUses: 0,
    fallbackUses: 0,
    totalContentTokens: 0,
    usesWithContent: 0,
    skills,
  };
}

describe("skills usage", () => {
  it("asks the index for the selected range, defaulting to all time", async () => {
    vi.setSystemTime(new Date("2026-09-20T12:00:00Z"));
    const store = useSkillsStore();
    expect(store.range).toBe("all");

    await store.loadUsage();

    expect(mocks.skillsUsageSummary).toHaveBeenCalledWith({
      fromDate: null,
      toDate: null,
    });
    vi.useRealTimers();
  });

  it("remembers the chosen range, so an older corpus is not empty on every visit", async () => {
    const store = useSkillsStore();
    await store.setRange("90d");
    expect(localStorage.getItem("tracepilot-skills-usage-range")).toBe("90d");
  });

  it("ignores a stored range that is no longer a valid option", () => {
    localStorage.setItem("tracepilot-skills-usage-range", "7d");
    expect(useSkillsStore().range).toBe("all");
  });

  it("drops the date bounds entirely for all-time", async () => {
    const store = useSkillsStore();
    await store.setRange("90d");
    await store.setRange("all");
    expect(mocks.skillsUsageSummary).toHaveBeenLastCalledWith({ fromDate: null, toDate: null });
  });

  it("does not refetch when the range is set to what it already is", async () => {
    const store = useSkillsStore();
    await store.loadUsage();
    mocks.skillsUsageSummary.mockClear();
    await store.setRange("all");
    expect(mocks.skillsUsageSummary).not.toHaveBeenCalled();
  });

  it("loads the catalog and usage together, and merges them into entries", async () => {
    mocks.skillsListAll.mockResolvedValue({ skills: ALL_SUMMARIES, diagnostics: [] });
    mocks.skillsUsageSummary.mockResolvedValue(
      summaryOf([usageStats("code-review", ALL_SUMMARIES[0].directory, 7)]),
    );
    const store = useSkillsStore();

    await store.loadAll();

    expect(store.entries.find((entry) => entry.name === "code-review")?.usage?.uses).toBe(7);
    expect(store.usedSkillCount).toBe(1);
  });

  it("still shows the installed catalog when the usage index is unavailable", async () => {
    mocks.skillsListAll.mockResolvedValue({ skills: ALL_SUMMARIES, diagnostics: [] });
    mocks.skillsUsageSummary.mockRejectedValue(new Error("no index"));
    const store = useSkillsStore();

    await store.loadAll();
    await flushPromises();

    expect(store.skills).toHaveLength(3);
    expect(store.usage).toBeNull();
    expect(store.usageError).toBe("no index");
    expect(store.error).toBeNull();
  });

  it("still reports usage when the catalog fails to load", async () => {
    mocks.skillsListAll.mockRejectedValue(new Error("no skills dir"));
    mocks.skillsUsageSummary.mockResolvedValue(summaryOf([usageStats("ghost", "/gone/ghost", 3)]));
    const store = useSkillsStore();

    await store.loadAll();
    await flushPromises();

    expect(store.error).toBe("no skills dir");
    expect(store.usage?.totalUses).toBe(3);
    // A skill with usage and no install is exactly the "missing" case.
    expect(store.missingSkills.map((entry) => entry.name)).toEqual(["ghost"]);
  });
});
