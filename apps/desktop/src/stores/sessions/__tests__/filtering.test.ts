import type { SessionListItem } from "@tracepilot/types";
import { describe, expect, it } from "vitest";
import {
  buildSearchFieldCache,
  compareSessions,
  filterAndSortSessions,
  matchesSessionFilters,
  PROJECT_FILTER_PREFIX,
  repositoryFilterOptions,
  sessionRepositoryKey,
  uniqueRepositories,
  uniqueSources,
} from "../filtering";

function s(overrides: Partial<SessionListItem> & { id: string }): SessionListItem {
  return {
    id: overrides.id,
    summary: overrides.summary ?? null,
    repository: overrides.repository ?? null,
    branch: overrides.branch ?? null,
    cwd: overrides.cwd ?? null,
    hostType: overrides.hostType ?? "cli",
    createdAt: overrides.createdAt ?? "2025-01-01T00:00:00Z",
    updatedAt: overrides.updatedAt ?? "2025-01-01T00:00:00Z",
    eventCount: overrides.eventCount ?? 0,
    turnCount: overrides.turnCount ?? 0,
    currentModel: overrides.currentModel ?? null,
    ...(overrides.source ? { source: overrides.source } : {}),
  } as SessionListItem;
}

const sample: SessionListItem[] = [
  s({
    id: "Aaa-111",
    summary: "Refactor SEARCH store",
    repository: "Org/Repo-One",
    branch: "main",
    turnCount: 5,
    eventCount: 50,
    updatedAt: "2025-03-01",
    createdAt: "2025-01-10",
  }),
  s({
    id: "bbb-222",
    summary: "fix indexing bug",
    repository: "org/repo-two",
    branch: "feat/x",
    turnCount: 0,
    eventCount: 1,
    updatedAt: "2025-02-15",
    createdAt: "2025-02-15",
  }),
  s({
    id: "ccc-333",
    summary: null,
    repository: "org/repo-one",
    branch: "main",
    turnCount: 2,
    eventCount: 10,
    updatedAt: "2025-04-01",
    createdAt: "2025-03-20",
  }),
];

describe("stores/sessions/filtering – matchesSessionFilters", () => {
  const cache = buildSearchFieldCache(sample);

  it("returns true when no predicates match anything to filter", () => {
    expect(
      matchesSessionFilters(
        sample[0],
        {
          searchTerm: null,
          repository: null,
          hideEmptySessions: false,
        },
        cache,
      ),
    ).toBe(true);
  });

  it("hideEmptySessions excludes turnCount=0 rows", () => {
    expect(
      matchesSessionFilters(
        sample[1],
        {
          searchTerm: null,
          repository: null,
          hideEmptySessions: true,
        },
        cache,
      ),
    ).toBe(false);
  });

  it("searchTerm matches case-insensitively across summary/repo/branch/id", () => {
    const p = {
      searchTerm: "search",
      repository: null,
      hideEmptySessions: false,
    };
    expect(matchesSessionFilters(sample[0], p, cache)).toBe(true);
    expect(matchesSessionFilters(sample[1], p, cache)).toBe(false);

    const idMatch = {
      searchTerm: "ccc",
      repository: null,
      hideEmptySessions: false,
    };
    expect(matchesSessionFilters(sample[2], idMatch, cache)).toBe(true);
  });

  it("fails closed when a session is missing from the cache", () => {
    expect(
      matchesSessionFilters(
        s({ id: "missing", summary: "anything" }),
        {
          searchTerm: "anything",
          repository: null,
          hideEmptySessions: false,
        },
        cache,
      ),
    ).toBe(false);
  });

  it("repository filter is exact-match", () => {
    expect(
      matchesSessionFilters(
        sample[0],
        {
          searchTerm: null,
          repository: "Org/Repo-One",
          hideEmptySessions: false,
        },
        cache,
      ),
    ).toBe(true);
    expect(
      matchesSessionFilters(
        sample[2],
        {
          searchTerm: null,
          repository: "Org/Repo-One",
          hideEmptySessions: false,
        },
        cache,
      ),
    ).toBe(false);
  });
});

describe("stores/sessions/filtering – compareSessions", () => {
  it("sorts by updatedAt desc by default", () => {
    const a = s({ id: "a", updatedAt: "2025-01-01" });
    const b = s({ id: "b", updatedAt: "2025-02-01" });
    expect(compareSessions(a, b, "updated")).toBeGreaterThan(0);
    expect(compareSessions(b, a, "updated")).toBeLessThan(0);
  });

  it("'oldest' inverts the order", () => {
    const a = s({ id: "a", updatedAt: "2025-01-01" });
    const b = s({ id: "b", updatedAt: "2025-02-01" });
    expect(compareSessions(a, b, "oldest")).toBeLessThan(0);
  });

  it("events / turns sort numerically descending", () => {
    const a = s({ id: "a", eventCount: 1, turnCount: 1 });
    const b = s({ id: "b", eventCount: 9, turnCount: 9 });
    expect(compareSessions(a, b, "events")).toBeGreaterThan(0);
    expect(compareSessions(a, b, "turns")).toBeGreaterThan(0);
  });
});

describe("stores/sessions/filtering – filterAndSortSessions integration", () => {
  it("applies filter then sort, returning a fresh array", () => {
    const cache = buildSearchFieldCache(sample);
    const out = filterAndSortSessions(
      sample,
      {
        searchTerm: null,
        repository: null,
        hideEmptySessions: true,
      },
      cache,
      "updated",
    );
    expect(out.map((x) => x.id)).toEqual(["ccc-333", "Aaa-111"]);
    expect(out).not.toBe(sample);
  });
});

describe("stores/sessions/filtering – uniqueRepositories", () => {
  it("returns sorted distinct repositories ignoring null", () => {
    expect(uniqueRepositories(sample)).toEqual(["Org/Repo-One", "org/repo-one", "org/repo-two"]);
  });
});

describe("stores/sessions/filtering – source", () => {
  const mixed = [s({ id: "cop-1" }), s({ id: "cc-1", source: "claudeCode" })];
  const base = { searchTerm: null, repository: null, hideEmptySessions: false };
  const cache = buildSearchFieldCache(mixed);

  it("treats sessions without a source as Copilot", () => {
    const out = filterAndSortSessions(mixed, { ...base, source: "copilot" }, cache, "updated");
    expect(out.map((x) => x.id)).toEqual(["cop-1"]);
  });

  it("keeps every source when the filter is unset", () => {
    expect(filterAndSortSessions(mixed, base, cache, "updated")).toHaveLength(2);
    const claude = filterAndSortSessions(
      mixed,
      { ...base, source: "claudeCode" },
      cache,
      "updated",
    );
    expect(claude.map((x) => x.id)).toEqual(["cc-1"]);
  });

  it("lists present sources in display order", () => {
    expect(uniqueSources(sample)).toEqual(["copilot"]);
    expect(uniqueSources([...mixed].reverse())).toEqual(["copilot", "claudeCode"]);
  });
});

describe("stores/sessions/filtering – working directory identity", () => {
  const claudeCwdOnly = s({
    id: "cc-cwd",
    source: "claudeCode",
    summary: "Tidy uploads",
    cwd: "C:\\synthetic\\Orchard",
    currentModel: "claude-opus-4-6",
  });
  const copilotWithRepo = s({
    id: "cop-repo",
    repository: "org/orchard-api",
    cwd: "/home/dev/orchard-api",
    currentModel: "gpt-5.4",
  });
  const sameNameElsewhere = s({ id: "cc-cwd-2", source: "claudeCode", cwd: "/work/Orchard/" });
  const noIdentity = s({ id: "cc-none", source: "claudeCode" });
  const all = [claudeCwdOnly, copilotWithRepo, sameNameElsewhere, noIdentity];
  const cache = buildSearchFieldCache(all);
  const base = { repository: null, hideEmptySessions: false };

  it("search matches the cwd and current model for every source", () => {
    const hits = (term: string) =>
      all
        .filter((x) => matchesSessionFilters(x, { ...base, searchTerm: term }, cache))
        .map((x) => x.id);
    expect(hits("synthetic\\orchard")).toEqual(["cc-cwd"]);
    expect(hits("/home/dev")).toEqual(["cop-repo"]);
    expect(hits("opus-4-6")).toEqual(["cc-cwd"]);
    expect(hits("gpt-5.4")).toEqual(["cop-repo"]);
  });

  it("groups a repository-less session under its cwd's last segment", () => {
    expect(sessionRepositoryKey(claudeCwdOnly)).toBe(`${PROJECT_FILTER_PREFIX}Orchard`);
    expect(sessionRepositoryKey(copilotWithRepo)).toBe("org/orchard-api");
    expect(sessionRepositoryKey(noIdentity)).toBeNull();
  });

  it("filters by a project key, and a repository key still matches exactly", () => {
    const pick = (repository: string) =>
      filterAndSortSessions(all, { ...base, searchTerm: null, repository }, cache, "updated").map(
        (x) => x.id,
      );
    expect(pick(`${PROJECT_FILTER_PREFIX}Orchard`)).toEqual(["cc-cwd", "cc-cwd-2"]);
    expect(pick("org/orchard-api")).toEqual(["cop-repo"]);
    expect(pick("Orchard")).toEqual([]);
  });

  it("lists repositories, then projects with every path behind them", () => {
    expect(repositoryFilterOptions(all)).toEqual([
      { value: "org/orchard-api", label: "org/orchard-api", group: "Repositories" },
      {
        value: `${PROJECT_FILTER_PREFIX}Orchard`,
        label: "Orchard",
        title: "/work/Orchard/\nC:\\synthetic\\Orchard",
        group: "Folders",
      },
    ]);
  });

  it("leaves a repository-only list unchanged", () => {
    expect(repositoryFilterOptions(sample).map((o) => o.value)).toEqual(uniqueRepositories(sample));
  });
});
