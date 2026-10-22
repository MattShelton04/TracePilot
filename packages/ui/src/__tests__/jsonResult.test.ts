import { describe, expect, it } from "vitest";
import { formatJsonResult, MAX_JSON_RESULT_CHARS } from "../utils/jsonResult";

describe("formatJsonResult", () => {
  it("re-indents an array of objects with two spaces", () => {
    expect(formatJsonResult('[{"number":1,"title":"First"},{"number":2,"labels":[]}]')).toBe(
      [
        "[",
        "  {",
        '    "number": 1,',
        '    "title": "First"',
        "  },",
        "  {",
        '    "number": 2,',
        '    "labels": []',
        "  }",
        "]",
      ].join("\n"),
    );
  });

  it("matches JSON.stringify for ordinary values and ignores surrounding whitespace", () => {
    const value = { a: [1, { b: null, c: false }], d: {}, e: "x, y: {z}", f: [] };
    expect(formatJsonResult(`\n  ${JSON.stringify(value)}  \n`)).toBe(
      JSON.stringify(value, null, 2),
    );
  });

  it("re-indents already indented JSON the same way", () => {
    const value = { items: [1, 2], nested: { empty: [] } };
    expect(formatJsonResult(JSON.stringify(value, null, "\t"))).toBe(
      JSON.stringify(value, null, 2),
    );
  });

  it("keeps string and number literals exactly as recorded", () => {
    const formatted = formatJsonResult(
      '{"id":12345678901234567890,"ratio":1.50,"text":"say \\"hi\\" \\u00e9 \\\\","id":2}',
    );
    expect(formatted).toBe(
      [
        "{",
        '  "id": 12345678901234567890,',
        '  "ratio": 1.50,',
        '  "text": "say \\"hi\\" \\u00e9 \\\\",',
        '  "id": 2',
        "}",
      ].join("\n"),
    );
  });

  it("leaves truncated and invalid JSON as plain text", () => {
    expect(formatJsonResult('[{"number":1,"title":"Fir')).toBeNull();
    expect(formatJsonResult('{"a":1,}')).toBeNull();
    expect(formatJsonResult("[1, 2] trailing")).toBeNull();
  });

  it("leaves plain text and JSON scalars as plain text", () => {
    expect(formatJsonResult("Process exited with code 0")).toBeNull();
    expect(formatJsonResult("")).toBeNull();
    expect(formatJsonResult('"just a string"')).toBeNull();
    expect(formatJsonResult("42")).toBeNull();
    expect(formatJsonResult("null")).toBeNull();
    expect(formatJsonResult("[link](https://example.com) and {braces}")).toBeNull();
  });

  it("does not parse payloads above the size cap", () => {
    const item = '{"value":"fixture"},';
    const huge = `[${item.repeat(Math.ceil(MAX_JSON_RESULT_CHARS / item.length))}{}]`;
    expect(huge.length).toBeGreaterThan(MAX_JSON_RESULT_CHARS);
    expect(() => JSON.parse(huge)).not.toThrow();
    expect(formatJsonResult(huge)).toBeNull();
  });
});
