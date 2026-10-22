import { describe, expect, it } from "vitest";
import { parseQualifiers, stripQualifier, stripTypeQualifier } from "../../utils/parseQualifiers";

describe("parseQualifiers", () => {
  it("returns unchanged query when no qualifiers are present", () => {
    const result = parseQualifiers("simple search query");
    expect(result.cleanQuery).toBe("simple search query");
    expect(result.types).toEqual([]);
    expect(result.repo).toBeNull();
    expect(result.tool).toBeNull();
    expect(result.session).toBeNull();
    expect(result.sort).toBeNull();
  });

  it("extracts type qualifier", () => {
    const result = parseQualifiers("type:error fix bug");
    expect(result.cleanQuery).toBe("fix bug");
    expect(result.types).toEqual(["error"]);
  });

  it("extracts multiple type qualifiers", () => {
    const result = parseQualifiers("type:error type:tool_error fix");
    expect(result.cleanQuery).toBe("fix");
    expect(result.types).toEqual(["error", "tool_error"]);
  });

  it("extracts repo qualifier", () => {
    const result = parseQualifiers("repo:myapp fix bug");
    expect(result.cleanQuery).toBe("fix bug");
    expect(result.repo).toBe("myapp");
  });

  it("extracts quoted values", () => {
    const result = parseQualifiers('repo:"my org/repo" fix bug');
    expect(result.cleanQuery).toBe("fix bug");
    expect(result.repo).toBe("my org/repo");
  });

  it("extracts tool qualifier", () => {
    const result = parseQualifiers("tool:grep search term");
    expect(result.cleanQuery).toBe("search term");
    expect(result.tool).toBe("grep");
  });

  it("extracts session qualifier", () => {
    const result = parseQualifiers("session:abc123 find code");
    expect(result.cleanQuery).toBe("find code");
    expect(result.session).toBe("abc123");
  });

  it("extracts sort qualifier with valid values", () => {
    expect(parseQualifiers("sort:newest query").sort).toBe("newest");
    expect(parseQualifiers("sort:oldest query").sort).toBe("oldest");
    expect(parseQualifiers("sort:relevance query").sort).toBe("relevance");
  });

  it("extracts source qualifier with its Claude Code spellings", () => {
    expect(parseQualifiers("source:copilot retry").source).toBe("copilot");
    for (const v of ["claude", "claudecode", "ClaudeCode", "claude-code"]) {
      const result = parseQualifiers(`retry source:${v}`);
      expect(result.source).toBe("claudeCode");
      expect(result.cleanQuery).toBe("retry");
    }
  });

  it("strips and ignores unknown source values", () => {
    const result = parseQualifiers("source:cursor retry");
    expect(result.source).toBeNull();
    expect(result.cleanQuery).toBe("retry");
    expect(parseQualifiers("source:constructor").source).toBeNull();
    expect(parseQualifiers("plain").source).toBeNull();
  });

  it("ignores invalid sort values", () => {
    expect(parseQualifiers("sort:invalid query").sort).toBeNull();
  });

  it("extracts multiple qualifiers at once", () => {
    const result = parseQualifiers("type:error repo:myapp tool:grep fix bug sort:newest");
    expect(result.cleanQuery).toBe("fix bug");
    expect(result.types).toEqual(["error"]);
    expect(result.repo).toBe("myapp");
    expect(result.tool).toBe("grep");
    expect(result.sort).toBe("newest");
  });

  it("handles query with only qualifiers (no text)", () => {
    const result = parseQualifiers("type:error repo:myapp");
    expect(result.cleanQuery).toBe("");
    expect(result.types).toEqual(["error"]);
    expect(result.repo).toBe("myapp");
  });

  it("is case-insensitive for qualifier keys", () => {
    const result = parseQualifiers("Type:error REPO:myapp");
    expect(result.types).toEqual(["error"]);
    expect(result.repo).toBe("myapp");
  });

  it("matches type values in any case and with - or _ between words", () => {
    const result = parseQualifiers("type:Error type:TOOL_CALL type:tool-result type:Tool-Error x");
    expect(result.types).toEqual(["error", "tool_call", "tool_result", "tool_error"]);
    expect(result.unknownTypes).toEqual([]);
    expect(result.cleanQuery).toBe("x");
  });

  it("strips unknown type values without filtering on them, and reports them once", () => {
    const result = parseQualifiers("type:bogus retry type:error type:bogus type:constructor");
    expect(result.types).toEqual(["error"]);
    expect(result.unknownTypes).toEqual(["bogus", "constructor"]);
    expect(result.cleanQuery).toBe("retry");
    expect(parseQualifiers("retry").unknownTypes).toEqual([]);
  });

  it("matches sort values in any case", () => {
    expect(parseQualifiers("sort:Newest query").sort).toBe("newest");
    expect(parseQualifiers("SORT:OLDEST query").sort).toBe("oldest");
    expect(parseQualifiers("sort:Relevance").sort).toBe("relevance");
  });

  it("handles empty string input", () => {
    const result = parseQualifiers("");
    expect(result.cleanQuery).toBe("");
    expect(result.types).toEqual([]);
    expect(result.repo).toBeNull();
  });

  it("collapses excess whitespace after stripping qualifiers", () => {
    const result = parseQualifiers("hello type:error   world");
    expect(result.cleanQuery).toBe("hello world");
  });

  it("reads a qualifier only at the start or after whitespace", () => {
    for (const text of ["config.session:abc", "pre-type:error", "src/repo:demo", "mcp.tool:grep"]) {
      const result = parseQualifiers(text);
      expect(result.cleanQuery).toBe(text);
      expect(result).toMatchObject({ types: [], repo: null, tool: null, session: null });
    }
    const spaced = parseQualifiers("config.session:abc\tsession:s1");
    expect(spaced.session).toBe("s1");
    expect(spaced.cleanQuery).toBe("config.session:abc");
  });
});

describe("stripQualifier", () => {
  it("removes every qualifier of one key, keeping the rest", () => {
    expect(stripQualifier("retry source:claude tool:shell", "source")).toBe("retry tool:shell");
    expect(stripQualifier('SOURCE:copilot "a b" source:"claude code"', "source")).toBe('"a b"');
  });

  it("returns a query without that key unchanged", () => {
    expect(stripQualifier("  retry  tool:shell ", "source")).toBe("  retry  tool:shell ");
  });

  it("leaves text that only contains a qualifier name alone", () => {
    expect(stripQualifier("config.source:claude", "source")).toBe("config.source:claude");
  });
});

describe("stripTypeQualifier", () => {
  it("removes every spelling of one type and keeps the other types", () => {
    expect(
      stripTypeQualifier("type:Tool-Error retry type:error type:tool_error", "tool_error"),
    ).toBe("retry type:error");
    expect(stripTypeQualifier("retry type:error", "tool_call")).toBe("retry type:error");
  });
});
