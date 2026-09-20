import type { SkillSummary, SkillUsageStats, SkillUsageSummary } from "@tracepilot/types";
import { describe, expect, it } from "vitest";
import type { SkillEntryFilter } from "../entries";
import {
  buildSkillEntries,
  DORMANT_DAYS,
  filterAndSortSkills,
  normalizeDirectory,
  shadowedSkillNames,
  skillRouteId,
  winningSkill,
} from "../entries";

const NOW = new Date("2026-09-20T12:00:00Z");
const day = (offset: number) => new Date(NOW.getTime() - offset * 86_400_000).toISOString();

function skill(name: string, overrides: Partial<SkillSummary> = {}): SkillSummary {
  return {
    name,
    description: `${name} does things`,
    scope: "global",
    directory: `C:\\Users\\a\\.copilot\\skills\\${name}`,
    frontmatterTokens: 120,
    instructionTokens: 900,
    enabled: true,
    hasAssets: false,
    assetCount: 0,
    modifiedAt: day(300),
    contentSha256: `sha-${name}`,
    ...overrides,
  };
}

function usage(name: string, overrides: Partial<SkillUsageStats> = {}): SkillUsageStats {
  return {
    name,
    normalizedName: name.toLowerCase(),
    description: null,
    uses: 5,
    sessions: 3,
    repositories: 1,
    firstUsed: day(20),
    lastUsed: day(2),
    userInvoked: 0,
    agentInvoked: 0,
    unknownTrigger: 5,
    mainAgentUses: 5,
    subagentUses: 0,
    fallbackUses: 0,
    medianContentTokens: 1000,
    usesWithContent: 5,
    latestContentSha256: `sha-${name.toLowerCase()}`,
    contentVersions: 1,
    paths: [
      {
        path: `C:\\Users\\a\\.copilot\\skills\\${name}\\SKILL.md`,
        directory: `c:/users/a/.copilot/skills/${name.toLowerCase()}`,
        uses: 5,
      },
    ],
    topModels: [],
    topRepositories: [],
    dailyUses: [],
    pluginName: null,
    source: null,
    ...overrides,
  };
}

function summary(skills: SkillUsageStats[]): SkillUsageSummary {
  return {
    totalUses: skills.reduce((sum, stats) => sum + stats.uses, 0),
    totalSessions: 1,
    unknownTriggerUses: 0,
    fallbackUses: 0,
    totalContentTokens: 0,
    usesWithContent: 0,
    skills,
  };
}

const flagsOf = (entries: ReturnType<typeof buildSkillEntries>, name: string) =>
  entries.find((entry) => entry.name === name)?.flags ?? [];

describe("normalizeDirectory", () => {
  it("folds separators, case and a trailing slash", () => {
    expect(normalizeDirectory("C:\\Users\\A\\.copilot\\skills\\Frontend\\")).toBe(
      "c:/users/a/.copilot/skills/frontend",
    );
  });
});

describe("buildSkillEntries", () => {
  it("matches usage to an installed skill by directory, not name", () => {
    // The real case: `testing-usability` lives in a `usability-testing` dir.
    const installed = skill("usability-testing", {
      scope: "repository",
      directory: "C:\\git\\portify\\.github\\skills\\usability-testing",
    });
    const stats = usage("testing-usability", {
      paths: [
        {
          path: "C:\\git\\portify\\.github\\skills\\usability-testing\\SKILL.md",
          directory: "c:/git/portify/.github/skills/usability-testing",
          uses: 12,
        },
      ],
      uses: 12,
    });

    const entries = buildSkillEntries([installed], summary([stats]), "90d", NOW);

    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe("installed");
    expect(entries[0].usage?.uses).toBe(12);
    expect(entries[0].flags).not.toContain("missing");
  });

  it("falls back to the name when no path was recorded", () => {
    const stats = usage("sdk-skill", { paths: [] });

    const entries = buildSkillEntries([skill("sdk-skill")], summary([stats]), "90d", NOW);

    expect(entries[0].kind).toBe("installed");
    expect(entries[0].usage?.uses).toBe(5);
  });

  it("keeps a used-but-uninstalled skill visible as missing", () => {
    const stats = usage("deleted-skill", {
      paths: [
        {
          path: "C:\\gone\\skills\\deleted-skill\\SKILL.md",
          directory: "c:/gone/skills/deleted-skill",
          uses: 4,
        },
      ],
    });

    const entries = buildSkillEntries([], summary([stats]), "90d", NOW);

    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe("missing");
    expect(entries[0].scope).toBe("missing");
    expect(entries[0].flags).toContain("missing");
    expect(entries[0].lastKnownPath).toBe("C:\\gone\\skills\\deleted-skill\\SKILL.md");
    expect(entries[0].listingTokens).toBe(0);
  });

  it("gives an installed skill with no usage no usage", () => {
    const entries = buildSkillEntries([skill("never-used")], summary([]), "90d", NOW);

    expect(entries[0].usage).toBeNull();
    expect(entries[0].kind).toBe("installed");
  });

  it("attaches a directory's usage to that directory only", () => {
    // The same skill name in two clones is two installed skills.
    const one = skill("app-automation", {
      scope: "repository",
      directory: "C:\\git\\one\\.github\\skills\\app-automation",
    });
    const two = skill("app-automation", {
      scope: "repository",
      directory: "C:\\git\\two\\.github\\skills\\app-automation",
    });
    const stats = usage("app-automation", {
      uses: 9,
      paths: [
        {
          path: "C:\\git\\two\\.github\\skills\\app-automation\\SKILL.md",
          directory: "c:/git/two/.github/skills/app-automation",
          uses: 9,
        },
      ],
    });

    const entries = buildSkillEntries([one, two], summary([stats]), "90d", NOW);

    expect(entries.find((entry) => entry.key.includes("/one/"))?.usage).toBeNull();
    expect(entries.find((entry) => entry.key.includes("/two/"))?.usage?.uses).toBe(9);
  });
});

describe("flags", () => {
  it("flags an enabled, long-installed skill with no uses as unused", () => {
    const entries = buildSkillEntries([skill("idle")], summary([]), "90d", NOW);
    expect(flagsOf(entries, "idle")).toContain("unused");
  });

  it("does not flag a skill installed inside the range as unused", () => {
    const entries = buildSkillEntries(
      [skill("brand-new", { modifiedAt: day(3) })],
      summary([]),
      "90d",
      NOW,
    );
    expect(flagsOf(entries, "brand-new")).not.toContain("unused");
  });

  it("flags a disabled skill with no uses as neither unused nor used-disabled", () => {
    const entries = buildSkillEntries([skill("off", { enabled: false })], summary([]), "90d", NOW);
    expect(flagsOf(entries, "off")).toEqual([]);
  });

  it("flags a disabled skill that sessions still invoked", () => {
    const entries = buildSkillEntries(
      [skill("still-used", { enabled: false })],
      summary([usage("still-used")]),
      "90d",
      NOW,
    );
    expect(flagsOf(entries, "still-used")).toContain("usedDisabled");
  });

  it("flags a skill last used beyond the dormant threshold", () => {
    const entries = buildSkillEntries(
      [skill("stale")],
      summary([usage("stale", { lastUsed: day(DORMANT_DAYS + 5) })]),
      "all",
      NOW,
    );
    expect(flagsOf(entries, "stale")).toContain("dormant");
  });

  it("flags content that changed since the last invocation", () => {
    const entries = buildSkillEntries(
      [skill("edited", { contentSha256: "sha-new" })],
      summary([usage("edited", { latestContentSha256: "sha-old" })]),
      "90d",
      NOW,
    );
    expect(flagsOf(entries, "edited")).toContain("drifted");
  });

  it("does not claim drift when no invocation carried content", () => {
    const entries = buildSkillEntries(
      [skill("fallback-only", { contentSha256: "sha-new" })],
      summary([usage("fallback-only", { latestContentSha256: null, usesWithContent: 0 })]),
      "90d",
      NOW,
    );
    expect(flagsOf(entries, "fallback-only")).not.toContain("drifted");
  });

  it("flags a name installed in two scopes as shadowed", () => {
    const entries = buildSkillEntries(
      [
        skill("pdf"),
        skill("pdf", { scope: "repository", directory: "C:\\git\\app\\.github\\skills\\pdf" }),
      ],
      summary([]),
      "90d",
      NOW,
    );
    expect(flagsOf(entries, "pdf")).toContain("shadowed");
    expect(shadowedSkillNames([skill("pdf")])).toEqual(new Set());
  });
});

describe("winningSkill", () => {
  it("prefers the most local scope", () => {
    const project = skill("pdf", {
      scope: "repository",
      directory: "C:\\git\\app\\.github\\skills\\pdf",
    });
    expect(winningSkill([skill("pdf"), project], "PDF")).toBe(project);
  });
});

describe("skillRouteId", () => {
  it("uses the directory when installed and the name when missing", () => {
    const entries = buildSkillEntries(
      [skill("here")],
      summary([usage("gone", { paths: [] })]),
      "90d",
      NOW,
    );
    const installed = entries.find((entry) => entry.name === "here");
    const missing = entries.find((entry) => entry.name === "gone");
    expect(skillRouteId(installed!)).toBe(installed?.skill?.directory);
    expect(skillRouteId(missing!)).toBe("name:gone");
  });
});

describe("filterAndSortSkills", () => {
  const entries = buildSkillEntries(
    [
      skill("alpha", { frontmatterTokens: 50 }),
      skill("beta", { frontmatterTokens: 400 }),
      skill("gamma", { scope: "builtin", frontmatterTokens: 10 }),
    ],
    summary([usage("alpha", { uses: 2, lastUsed: day(10) }), usage("beta", { uses: 9 })]),
    "90d",
    NOW,
  );
  const base: SkillEntryFilter = { scope: "all", flags: new Set(), search: "", sort: "uses" };

  it("sorts by uses with unused skills last", () => {
    const names = filterAndSortSkills(entries, base).map((entry) => entry.name);
    expect(names).toEqual(["beta", "alpha", "gamma"]);
  });

  it("sorts by listing cost", () => {
    const names = filterAndSortSkills(entries, { ...base, sort: "listingCost" }).map(
      (entry) => entry.name,
    );
    expect(names).toEqual(["beta", "alpha", "gamma"]);
  });

  it("sorts by last used, with never-used last", () => {
    const names = filterAndSortSkills(entries, { ...base, sort: "lastUsed" }).map(
      (entry) => entry.name,
    );
    expect(names).toEqual(["beta", "alpha", "gamma"]);
  });

  it("narrows by scope, flag and search together", () => {
    expect(filterAndSortSkills(entries, { ...base, scope: "builtin" })).toHaveLength(1);
    expect(
      filterAndSortSkills(entries, { ...base, flags: new Set(["unused"]) }).map((e) => e.name),
    ).toEqual(["gamma"]);
    expect(filterAndSortSkills(entries, { ...base, search: "BET" }).map((e) => e.name)).toEqual([
      "beta",
    ]);
  });

  it("requires every selected flag, not any of them", () => {
    expect(
      filterAndSortSkills(entries, { ...base, flags: new Set(["unused", "drifted"]) }),
    ).toHaveLength(0);
  });
});
