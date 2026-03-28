import { describe, it, expect } from "vitest";
import { formatObjectResult } from "../../utils/formatResult";

describe("formatObjectResult", () => {
  // ── String inputs ─────────────────────────────────────────────────────────

  describe("string passthrough", () => {
    it("returns a plain string unchanged", () => {
      expect(formatObjectResult("hello world")).toBe("hello world");
    });

    it("returns an empty string unchanged", () => {
      expect(formatObjectResult("")).toBe("");
    });

    it("preserves whitespace in strings", () => {
      expect(formatObjectResult("  spaces  ")).toBe("  spaces  ");
    });

    it("preserves multiline strings", () => {
      const multiline = "line1\nline2\nline3";
      expect(formatObjectResult(multiline)).toBe(multiline);
    });
  });

  // ── Content extraction ────────────────────────────────────────────────────

  describe("content extraction from objects", () => {
    it("extracts content field from a content-only object", () => {
      expect(formatObjectResult({ content: "extracted text" })).toBe("extracted text");
    });

    it("extracts detailedContent field from a detailedContent-only object", () => {
      expect(formatObjectResult({ detailedContent: "detailed text" })).toBe("detailed text");
    });

    it("prefers content over detailedContent when both are present", () => {
      expect(
        formatObjectResult({ content: "primary", detailedContent: "fallback" }),
      ).toBe("primary");
    });

    it("falls back to detailedContent when content is empty", () => {
      expect(
        formatObjectResult({ content: "", detailedContent: "fallback" }),
      ).toBe("fallback");
    });

    it("falls back to detailedContent when content is whitespace-only", () => {
      expect(
        formatObjectResult({ content: "   ", detailedContent: "fallback" }),
      ).toBe("fallback");
    });

    it("extracts content even when empty counterpart is present", () => {
      // Object keys: content (non-empty) + detailedContent (empty) → still extract
      expect(
        formatObjectResult({ content: "text", detailedContent: "" }),
      ).toBe("text");
    });

    it("extracts content when other fields are null/empty/false", () => {
      // These "empty" values are filtered out by the meaningful-keys check
      expect(
        formatObjectResult({ content: "text", extra: null, flag: false, note: "" }),
      ).toBe("text");
    });
  });

  // ── JSON.stringify fallback ───────────────────────────────────────────────

  describe("JSON.stringify fallback", () => {
    it("returns JSON for objects with non-text extra fields", () => {
      const obj = { content: "text", extra: 42 };
      const result = formatObjectResult(obj);
      expect(result).toBe(JSON.stringify(obj, null, 2));
    });

    it("returns JSON for objects without content/detailedContent", () => {
      const obj = { name: "test", value: 123 };
      expect(formatObjectResult(obj)).toBe(JSON.stringify(obj, null, 2));
    });

    it("returns JSON for arrays", () => {
      const arr = [1, 2, 3];
      expect(formatObjectResult(arr)).toBe(JSON.stringify(arr, null, 2));
    });

    it("returns JSON for nested objects", () => {
      const obj = { a: { b: { c: true } } };
      expect(formatObjectResult(obj)).toBe(JSON.stringify(obj, null, 2));
    });

    it("returns 'null' for null input", () => {
      expect(formatObjectResult(null)).toBe("null");
    });

    it("returns 'undefined' string for undefined input", () => {
      // Explicit early return ensures the function always returns a string,
      // even though callers guard against undefined in practice.
      expect(formatObjectResult(undefined)).toBe("undefined");
    });

    it("returns JSON for number input", () => {
      expect(formatObjectResult(42)).toBe("42");
    });

    it("returns JSON for boolean input", () => {
      expect(formatObjectResult(true)).toBe("true");
      expect(formatObjectResult(false)).toBe("false");
    });

    it("returns pretty-printed JSON (2-space indent)", () => {
      const obj = { key: "value" };
      const result = formatObjectResult(obj);
      expect(result).toContain("\n");
      expect(result).toContain("  ");
    });
  });

  // ── String() fallback for non-serializable ────────────────────────────────

  describe("String() fallback for non-serializable values", () => {
    it("handles circular references gracefully", () => {
      const obj: Record<string, unknown> = { a: 1 };
      obj.self = obj;
      const result = formatObjectResult(obj);
      expect(typeof result).toBe("string");
      expect(result).toBe("[object Object]");
    });

    it("handles BigInt values via String fallback", () => {
      // BigInt causes JSON.stringify to throw
      const result = formatObjectResult(BigInt(42));
      expect(result).toBe("42");
    });

    it("handles Symbol values via ?? String fallback", () => {
      // JSON.stringify(Symbol()) returns undefined without throwing
      const result = formatObjectResult(Symbol("test"));
      expect(typeof result).toBe("string");
      expect(result).toBe("Symbol(test)");
    });

    it("handles function values via ?? String fallback", () => {
      // JSON.stringify(function) returns undefined without throwing
      const result = formatObjectResult(() => 42);
      expect(typeof result).toBe("string");
    });
  });

  // ── Edge cases ────────────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("handles empty object", () => {
      expect(formatObjectResult({})).toBe("{}");
    });

    it("handles object with only null/empty/false values (no meaningful keys)", () => {
      // All keys are filtered out → keys.length === 0, every() returns true vacuously
      // But text is null since content/detailedContent don't exist → JSON fallback
      const obj = { a: null, b: "", c: false };
      expect(formatObjectResult(obj)).toBe(JSON.stringify(obj, null, 2));
    });

    it("handles object where content is not a string", () => {
      const obj = { content: 42 };
      expect(formatObjectResult(obj)).toBe(JSON.stringify(obj, null, 2));
    });

    it("handles object where detailedContent is not a string", () => {
      const obj = { detailedContent: [1, 2, 3] };
      expect(formatObjectResult(obj)).toBe(JSON.stringify(obj, null, 2));
    });

    it("handles Date objects", () => {
      const date = new Date("2025-01-01T00:00:00Z");
      const result = formatObjectResult(date);
      // Date is an object, not an array, but has no content/detailedContent
      // JSON.stringify converts Date to ISO string
      expect(result).toContain("2025-01-01");
    });

    it("handles array of objects", () => {
      const arr = [{ content: "a" }, { content: "b" }];
      expect(formatObjectResult(arr)).toBe(JSON.stringify(arr, null, 2));
    });

    it("does not extract content when object has other truthy fields", () => {
      // This verifies the "extra fields" logic
      const obj = { content: "text", status: "ok" };
      const result = formatObjectResult(obj);
      // "status" is truthy and not in textKeys → falls through to JSON
      expect(result).toBe(JSON.stringify(obj, null, 2));
    });
  });

  // ── Backward compatibility ────────────────────────────────────────────────

  describe("backward compatibility with original formatResult", () => {
    it("matches formatResult behavior for string input", () => {
      expect(formatObjectResult("hello")).toBe("hello");
    });

    it("matches formatResult behavior for content-only object", () => {
      expect(formatObjectResult({ content: "extracted" })).toBe("extracted");
    });

    it("matches formatResult behavior for complex object", () => {
      const obj = { content: "text", metadata: { tool: "grep" } };
      expect(formatObjectResult(obj)).toBe(JSON.stringify(obj, null, 2));
    });
  });

  describe("backward compatibility with original formatDetail", () => {
    it("matches formatDetail behavior for string input", () => {
      expect(formatObjectResult("detail text")).toBe("detail text");
    });

    it("matches formatDetail behavior for plain object (JSON output)", () => {
      const obj = { error: "something failed", code: 42 };
      expect(formatObjectResult(obj)).toBe(JSON.stringify(obj, null, 2));
    });

    it("matches formatDetail behavior for circular references", () => {
      const obj: Record<string, unknown> = { a: 1 };
      obj.self = obj;
      const result = formatObjectResult(obj);
      expect(typeof result).toBe("string");
    });
  });
});
