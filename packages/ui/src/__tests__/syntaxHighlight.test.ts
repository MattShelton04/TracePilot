import { describe, expect, it } from "vitest";
import { highlightLine, highlightSql } from "../utils/syntaxHighlight";

describe("syntaxHighlight", () => {
  it("returns identical output for repeated same-language calls", () => {
    const line = 'const result = formatValue("ok")';

    expect(highlightLine(line, "typescript")).toBe(highlightLine(line, "typescript"));
  });

  it("does not leak regex state across mixed-language calls", () => {
    const tsLine = 'const result = formatValue("ok")';
    const sqlLine = "select count(*) from sessions";

    const firstTs = highlightLine(tsLine, "typescript");
    const sql = highlightLine(sqlLine, "sql");
    const secondTs = highlightLine(tsLine, "typescript");

    expect(firstTs).toBe(secondTs);
    expect(sql).toContain('<span class="syn-keyword">select</span>');
    expect(sql).toContain('<span class="syn-keyword">from</span>');
  });

  it("reuses canonical rules across language aliases", () => {
    const line = "const value = helper()";

    expect(highlightLine(line, "typescript")).toBe(highlightLine(line, "tsx"));
    expect(highlightLine(line, "typescript")).toBe(highlightLine(line, "javascript"));
  });

  it("escapes unsupported languages without adding syntax spans", () => {
    expect(highlightLine('<script>alert("xss")</script>', "unknown")).toBe(
      "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;",
    );
  });

  it("keeps SQL keyword highlighting case-insensitive", () => {
    const html = highlightLine("select * from sessions where id = 1", "sql");

    expect(html).toContain('<span class="syn-keyword">select</span>');
    expect(html).toContain('<span class="syn-keyword">from</span>');
    expect(html).toContain('<span class="syn-keyword">where</span>');
  });

  it("highlightSql delegates to SQL highlighting", () => {
    const sql = "SELECT * FROM sessions";

    expect(highlightSql(sql)).toBe(highlightLine(sql, "sql"));
  });
});
