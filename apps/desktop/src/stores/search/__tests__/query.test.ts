import { describe, expect, it } from "vitest";
import { type ParsedQualifiers, parseQualifiers } from "@/utils/parseQualifiers";
import { mergeSearchInputs } from "../query";

const baseParsed: ParsedQualifiers = {
  cleanQuery: "",
  types: [],
  unknownTypes: [],
  repo: null,
  tool: null,
  session: null,
  source: null,
  sort: null,
};

describe("stores/search/query – mergeSearchInputs", () => {
  it("never forwards an unknown type: value as a content type filter", () => {
    const state = {
      contentTypes: [],
      repository: null,
      toolName: null,
      sessionId: null,
      source: null,
      sortBy: "relevance",
      isBrowseMode: false,
    } as const;
    const unknownOnly = mergeSearchInputs(parseQualifiers("type:bogus retry"), state);
    expect(unknownOnly.contentTypes).toEqual([]);
    expect(unknownOnly.searchQuery).toBe("retry");

    const mixed = mergeSearchInputs(parseQualifiers("type:Tool-Call type:bogus retry"), {
      ...state,
      contentTypes: ["error"],
    });
    expect(mixed.contentTypes).toEqual(["error", "tool_call"]);
  });

  it("falls back to slice state when no qualifiers are present", () => {
    const merged = mergeSearchInputs(
      { ...baseParsed, cleanQuery: "needle" },
      {
        contentTypes: ["error"],
        repository: "org/repo",
        toolName: "shell",
        sessionId: "s1",
        source: "claudeCode",
        sortBy: "newest",
        isBrowseMode: false,
      },
    );

    expect(merged.searchQuery).toBe("needle");
    expect(merged.contentTypes).toEqual(["error"]);
    expect(merged.repository).toBe("org/repo");
    expect(merged.toolName).toBe("shell");
    expect(merged.sessionId).toBe("s1");
    expect(merged.source).toBe("claudeCode");
    expect(merged.sortBy).toBe("newest");
  });

  it("downgrades relevance → newest in browse mode", () => {
    const merged = mergeSearchInputs(baseParsed, {
      contentTypes: [],
      repository: null,
      toolName: null,
      sessionId: null,
      source: null,
      sortBy: "relevance",
      isBrowseMode: true,
    });
    expect(merged.sortBy).toBe("newest");
  });

  it("lists a qualifier-only query newest first, even with sort:relevance", () => {
    const state = {
      contentTypes: [],
      repository: null,
      toolName: null,
      sessionId: null,
      source: null,
      sortBy: "relevance",
      isBrowseMode: true,
    } as const;
    expect(mergeSearchInputs(parseQualifiers("type:error"), state).sortBy).toBe("newest");
    expect(mergeSearchInputs(parseQualifiers("type:error sort:relevance"), state).sortBy).toBe(
      "newest",
    );
    expect(mergeSearchInputs(parseQualifiers("type:error sort:oldest"), state).sortBy).toBe(
      "oldest",
    );
  });

  it("keeps relevance when there is a query", () => {
    const merged = mergeSearchInputs(
      { ...baseParsed, cleanQuery: "foo" },
      {
        contentTypes: [],
        repository: null,
        toolName: null,
        sessionId: null,
        source: null,
        sortBy: "relevance",
        isBrowseMode: false,
      },
    );
    expect(merged.sortBy).toBe("relevance");
  });

  it("merges qualifier types with explicit content types and dedupes", () => {
    const merged = mergeSearchInputs(
      { ...baseParsed, types: ["error", "tool_call"] },
      {
        contentTypes: ["error", "user_message"],
        repository: null,
        toolName: null,
        sessionId: null,
        source: null,
        sortBy: "relevance",
        isBrowseMode: false,
      },
    );
    expect(merged.contentTypes.sort()).toEqual(["error", "tool_call", "user_message"].sort());
  });

  it("qualifier values override slice state for repo/tool/session/source/sort", () => {
    const merged = mergeSearchInputs(
      {
        cleanQuery: "x",
        types: [],
        unknownTypes: [],
        repo: "qual/repo",
        tool: "qualtool",
        session: "qual-session",
        source: "copilot",
        sort: "oldest",
      },
      {
        contentTypes: [],
        repository: "ui/repo",
        toolName: "uitool",
        sessionId: "ui-session",
        source: "claudeCode",
        sortBy: "newest",
        isBrowseMode: false,
      },
    );
    expect(merged.repository).toBe("qual/repo");
    expect(merged.toolName).toBe("qualtool");
    expect(merged.sessionId).toBe("qual-session");
    expect(merged.source).toBe("copilot");
    expect(merged.sortBy).toBe("oldest");
  });

  it("returns parsed.cleanQuery verbatim (including empty string for browse)", () => {
    expect(
      mergeSearchInputs(baseParsed, {
        contentTypes: [],
        repository: null,
        toolName: null,
        sessionId: null,
        source: null,
        sortBy: "relevance",
        isBrowseMode: true,
      }).searchQuery,
    ).toBe("");
  });
});
