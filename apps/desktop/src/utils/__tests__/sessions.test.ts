import { describe, expect, it } from "vitest";
import { filterSessionsBySubstring } from "../sessions";

interface S {
  id: string;
  summary?: string | null;
  repository?: string | null;
}

const sessions: S[] = [
  { id: "abc123", summary: "Refactor export tab", repository: "Org/TracePilot" },
  { id: "def456", summary: "Fix replay bug", repository: "Org/TracePilot" },
  { id: "ghi789", summary: null, repository: "other/repo" },
  { id: "jkl000", summary: "Investigate CI flake", repository: null },
];

describe("utils/sessions – filterSessionsBySubstring", () => {
  it("returns input unchanged when query is empty", () => {
    expect(filterSessionsBySubstring(sessions, "")).toBe(sessions);
  });

  it("returns input unchanged when query is only whitespace (trimming)", () => {
    expect(filterSessionsBySubstring(sessions, "   ")).toBe(sessions);
  });

  it("trims surrounding whitespace before matching", () => {
    const result = filterSessionsBySubstring(sessions, "  replay  ");
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("def456");
  });

  it("matches case-insensitively against summary", () => {
    const result = filterSessionsBySubstring(sessions, "REFACTOR");
    expect(result.map((s) => s.id)).toEqual(["abc123"]);
  });

  it("matches case-insensitively against repository", () => {
    const result = filterSessionsBySubstring(sessions, "tracepilot");
    expect(result.map((s) => s.id).sort()).toEqual(["abc123", "def456"]);
  });

  it("matches against session id", () => {
    const result = filterSessionsBySubstring(sessions, "ghi");
    expect(result.map((s) => s.id)).toEqual(["ghi789"]);
  });

  it("tolerates null summary / repository fields", () => {
    const result = filterSessionsBySubstring(sessions, "jkl");
    expect(result.map((s) => s.id)).toEqual(["jkl000"]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterSessionsBySubstring(sessions, "no-such-thing")).toEqual([]);
  });
});
