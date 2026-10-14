import type { SessionListItem } from "@tracepilot/types";
import { describe, expect, it } from "vitest";
import { buildSearchFieldCache } from "@/stores/sessions/filtering";
import { filterSessionsByQuery } from "../sessions";

const sessions: SessionListItem[] = [
  {
    id: "abc123",
    summary: "Refactor export tab",
    repository: "Org/TracePilot",
    branch: "feat/export",
    isRunning: false,
  },
  { id: "def456", summary: "Fix replay bug", repository: "Org/TracePilot", isRunning: false },
  { id: "ghi789", summary: null, repository: "other/repo", isRunning: false },
  { id: "jkl000", summary: "Investigate CI flake", repository: null, isRunning: false },
  {
    id: "mno111",
    summary: "Fix login bug",
    source: "claudeCode",
    repository: null,
    cwd: "C:\\synthetic\\harbor",
    currentModel: "claude-opus-5-5",
    isRunning: false,
  },
];

const ids = (result: readonly SessionListItem[]) => result.map((s) => s.id);

describe("utils/sessions – filterSessionsByQuery", () => {
  it("returns the input unchanged for a blank query", () => {
    expect(filterSessionsByQuery(sessions, "")).toBe(sessions);
    expect(filterSessionsByQuery(sessions, "   ")).toBe(sessions);
  });

  it("matches case-insensitively against summary, repository and id", () => {
    expect(ids(filterSessionsByQuery(sessions, "  REFACTOR  "))).toEqual(["abc123"]);
    expect(ids(filterSessionsByQuery(sessions, "tracepilot"))).toEqual(["abc123", "def456"]);
    expect(ids(filterSessionsByQuery(sessions, "ghi"))).toEqual(["ghi789"]);
  });

  it("matches every word, in any order", () => {
    expect(ids(filterSessionsByQuery(sessions, "login fix"))).toEqual(["mno111"]);
    expect(ids(filterSessionsByQuery(sessions, "fix bug"))).toEqual(["def456", "mno111"]);
    expect(ids(filterSessionsByQuery(sessions, "fix tracepilot"))).toEqual(["def456"]);
  });

  it("finds a repository-less session by its folder, branch or model, as the list does", () => {
    expect(ids(filterSessionsByQuery(sessions, "harbor"))).toEqual(["mno111"]);
    expect(ids(filterSessionsByQuery(sessions, "feat/export"))).toEqual(["abc123"]);
    expect(ids(filterSessionsByQuery(sessions, "opus-5.5"))).toEqual(["mno111"]);
  });

  it("returns an empty array when any word matches nothing", () => {
    expect(filterSessionsByQuery(sessions, "no-such-thing")).toEqual([]);
    expect(filterSessionsByQuery(sessions, "login nowhere")).toEqual([]);
  });

  it("uses a caller's prebuilt field cache", () => {
    const cache = buildSearchFieldCache(sessions.slice(0, 1));
    // Sessions missing from the cache fail closed, like the session list.
    expect(ids(filterSessionsByQuery(sessions, "fix", cache))).toEqual([]);
    expect(ids(filterSessionsByQuery(sessions, "refactor", cache))).toEqual(["abc123"]);
  });
});
