import { describe, expect, it } from "vitest";
import { parseQualifiers } from "../../utils/parseQualifiers";

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
});
