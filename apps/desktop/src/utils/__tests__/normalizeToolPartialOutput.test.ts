import { describe, expect, it } from "vitest";
import { normalizeToolPartialOutput } from "../normalizeToolPartialOutput";

describe("normalizeToolPartialOutput", () => {
  it("returns empty string for null", () => {
    expect(normalizeToolPartialOutput(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(normalizeToolPartialOutput(undefined)).toBe("");
  });

  it("passes through string payloads byte-for-byte (no trim)", () => {
    expect(normalizeToolPartialOutput("hello world")).toBe("hello world");
    expect(normalizeToolPartialOutput("  padded  ")).toBe("  padded  ");
    expect(normalizeToolPartialOutput("")).toBe("");
  });

  it("pretty-prints object payloads with 2-space indent", () => {
    const obj = { foo: "bar", n: 1 };
    expect(normalizeToolPartialOutput(obj)).toBe(JSON.stringify(obj, null, 2));
  });

  it("supports progressive JSON growth (object whose shape grows over time)", () => {
    // Earlier in the stream:
    const partial = { lines: ["a"] };
    expect(normalizeToolPartialOutput(partial)).toBe(JSON.stringify(partial, null, 2));
    // Later in the stream — caller passes the latest accumulated value.
    const grown = { lines: ["a", "b", "c"], done: false };
    expect(normalizeToolPartialOutput(grown)).toBe(JSON.stringify(grown, null, 2));
  });

  it("pretty-prints array payloads", () => {
    const arr = [1, 2, { x: true }];
    expect(normalizeToolPartialOutput(arr)).toBe(JSON.stringify(arr, null, 2));
  });

  it("stringifies primitive numbers and booleans via JSON", () => {
    expect(normalizeToolPartialOutput(42)).toBe("42");
    expect(normalizeToolPartialOutput(true)).toBe("true");
  });

  it("falls back to String() when JSON.stringify throws (circular ref)", () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    expect(normalizeToolPartialOutput(circular)).toBe(String(circular));
  });

  it("returns empty string when JSON.stringify yields undefined (e.g. function payload)", () => {
    // JSON.stringify(() => {}) === undefined. We surface "" so callers can
    // uniformly skip empty payloads.
    const fn = () => 1;
    expect(normalizeToolPartialOutput(fn)).toBe("");
  });
});
