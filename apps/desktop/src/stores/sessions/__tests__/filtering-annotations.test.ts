import type { SessionListItem } from "@tracepilot/types";
import { describe, expect, it } from "vitest";
import {
  buildSearchFieldCache,
  filterAndSortSessions,
  type matchesSessionFilters,
} from "../filtering";

function s(id: string, updatedAt: string): SessionListItem {
  return { id, summary: null, updatedAt, turnCount: 1 } as SessionListItem;
}

const sample = [s("Aaa-111", "2025-03-01"), s("bbb-222", "2025-02-15"), s("ccc-333", "2025-04-01")];

describe("stores/sessions/filtering – annotations", () => {
  const cache = buildSearchFieldCache(sample);
  const annotations = new Map([
    ["Aaa-111", { starred: true, archived: false, tags: ["Auth"], note: null }],
    ["bbb-222", { starred: true, archived: true, tags: [], note: "Flaky retry loop" }],
    ["ccc-333", { starred: false, archived: false, tags: ["auth", "perf"], note: null }],
  ]);
  const ids = (predicates: Partial<Parameters<typeof matchesSessionFilters>[1]>) =>
    filterAndSortSessions(
      sample,
      { searchTerm: null, repository: null, hideEmptySessions: false, annotations, ...predicates },
      cache,
      "updated",
    ).map((x) => x.id);

  it("hides archived sessions by default", () => {
    expect(ids({})).toEqual(["ccc-333", "Aaa-111"]);
  });

  it("shows only starred sessions that are not archived in the starred scope", () => {
    expect(ids({ scope: "starred" })).toEqual(["Aaa-111"]);
  });

  it("shows only archived sessions in the archived scope", () => {
    expect(ids({ scope: "archived" })).toEqual(["bbb-222"]);
  });

  it("filters by tag ignoring case", () => {
    expect(ids({ tag: "AUTH" })).toEqual(["ccc-333", "Aaa-111"]);
    expect(ids({ tag: "perf" })).toEqual(["ccc-333"]);
  });

  it("search matches tags and notes", () => {
    expect(ids({ searchTerm: "perf" })).toEqual(["ccc-333"]);
    expect(ids({ scope: "archived", searchTerm: "retry" })).toEqual(["bbb-222"]);
  });

  it("treats every session as unannotated without an annotation map", () => {
    expect(ids({ annotations: undefined })).toHaveLength(3);
  });
});
