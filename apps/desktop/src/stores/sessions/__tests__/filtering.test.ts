import type { SessionListItem } from "@tracepilot/types";
import { describe, expect, it } from "vitest";
import {
  buildSearchFieldCache,
  compareSessions,
  filterAndSortSessions,
  matchesSessionFilters,
  uniqueBranches,
  uniqueRepositories,
} from "../filtering";

function s(overrides: Partial<SessionListItem> & { id: string }): SessionListItem {
  return {
    id: overrides.id,
    summary: overrides.summary ?? null,
    repository: overrides.repository ?? null,
    branch: overrides.branch ?? null,
    hostType: overrides.hostType ?? "cli",
    createdAt: overrides.createdAt ?? "2025-01-01T00:00:00Z",
    updatedAt: overrides.updatedAt ?? "2025-01-01T00:00:00Z",
    eventCount: overrides.eventCount ?? 0,
    turnCount: overrides.turnCount ?? 0,
    currentModel: overrides.currentModel ?? null,
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
          branch: null,
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
          branch: null,
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
      branch: null,
      hideEmptySessions: false,
    };
    expect(matchesSessionFilters(sample[0], p, cache)).toBe(true);
    expect(matchesSessionFilters(sample[1], p, cache)).toBe(false);

    const idMatch = {
      searchTerm: "ccc",
      repository: null,
      branch: null,
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
          branch: null,
          hideEmptySessions: false,
        },
        cache,
      ),
    ).toBe(false);
  });

  it("repository and branch filters are exact-match", () => {
    expect(
      matchesSessionFilters(
        sample[0],
        {
          searchTerm: null,
          repository: "Org/Repo-One",
          branch: "main",
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
          branch: null,
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
        branch: null,
        hideEmptySessions: true,
      },
      cache,
      "updated",
    );
    expect(out.map((x) => x.id)).toEqual(["ccc-333", "Aaa-111"]);
    expect(out).not.toBe(sample);
  });
});

describe("stores/sessions/filtering – uniqueRepositories / uniqueBranches", () => {
  it("returns sorted distinct repositories ignoring null", () => {
    expect(uniqueRepositories(sample)).toEqual(["Org/Repo-One", "org/repo-one", "org/repo-two"]);
  });

  it("scopes branches to a repository when one is provided", () => {
    expect(uniqueBranches(sample, null)).toEqual(["feat/x", "main"]);
    expect(uniqueBranches(sample, "Org/Repo-One")).toEqual(["main"]);
    expect(uniqueBranches(sample, "org/repo-two")).toEqual(["feat/x"]);
  });
});
