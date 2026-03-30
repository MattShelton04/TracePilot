import type { SearchResult } from "@tracepilot/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stripHtml, useSearchClipboard } from "../../composables/useSearchClipboard";

// ── Clipboard mock ────────────────────────────────────────────
let clipboardText = "";

beforeEach(() => {
  clipboardText = "";
  Object.assign(navigator, {
    clipboard: {
      writeText: vi.fn(async (text: string) => {
        clipboardText = text;
      }),
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Helper: minimal SearchResult factory
function makeResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id: 1,
    sessionId: "sess-1",
    contentType: "tool_call",
    snippet: "<mark>hello</mark> world",
    turnNumber: 1,
    eventIndex: null,
    timestampUnix: null,
    sessionSummary: null,
    sessionRepository: null,
    sessionBranch: null,
    sessionUpdatedAt: null,
    toolName: null,
    metadataJson: null,
    ...overrides,
  };
}

describe("stripHtml", () => {
  it("returns empty string for empty input", () => {
    expect(stripHtml("")).toBe("");
  });

  it("strips HTML tags and returns text content", () => {
    expect(stripHtml("<mark>hello</mark> world")).toBe("hello world");
  });

  it("handles nested tags", () => {
    expect(stripHtml("<div><span>nested</span></div>")).toBe("nested");
  });

  it("handles code-like content with angle brackets", () => {
    const html = "if (a &lt; b &amp;&amp; c &gt; d)";
    expect(stripHtml(html)).toBe("if (a < b && c > d)");
  });

  it("preserves plain text without tags", () => {
    expect(stripHtml("just text")).toBe("just text");
  });
});

describe("useSearchClipboard", () => {
  describe("copyResultsToClipboard", () => {
    it("returns false for empty array", async () => {
      const { copyResultsToClipboard } = useSearchClipboard();
      const ok = await copyResultsToClipboard([]);
      expect(ok).toBe(false);
      expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    });

    it("copies single result with session summary", async () => {
      const { copyResultsToClipboard } = useSearchClipboard();
      const result = makeResult({
        sessionSummary: "My Session",
        contentType: "tool_call",
        toolName: "grep",
        snippet: "<mark>match</mark> found",
      });

      const ok = await copyResultsToClipboard([result]);
      expect(ok).toBe(true);
      expect(clipboardText).toContain("[My Session] tool call · grep");
      expect(clipboardText).toContain("match found");
    });

    it("copies single result without session summary", async () => {
      const { copyResultsToClipboard } = useSearchClipboard();
      const result = makeResult({
        sessionSummary: null,
        contentType: "user_message",
        toolName: null,
        snippet: "plain text",
      });

      const ok = await copyResultsToClipboard([result]);
      expect(ok).toBe(true);
      expect(clipboardText).toContain("[user message]");
    });

    it("separates multiple results with dividers", async () => {
      const { copyResultsToClipboard } = useSearchClipboard();
      const results = [makeResult({ snippet: "first" }), makeResult({ snippet: "second" })];

      await copyResultsToClipboard(results);
      expect(clipboardText).toContain("---");
      expect(clipboardText).toContain("first");
      expect(clipboardText).toContain("second");
    });

    it("returns false when clipboard API fails", async () => {
      (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("denied"),
      );
      const { copyResultsToClipboard } = useSearchClipboard();

      const ok = await copyResultsToClipboard([makeResult()]);
      expect(ok).toBe(false);
    });
  });

  describe("copySingleResult", () => {
    it("includes session summary when available", async () => {
      const { copySingleResult } = useSearchClipboard();
      const result = makeResult({
        sessionSummary: "Test Session",
        contentType: "error",
        toolName: "compile",
        turnNumber: 5,
        sessionRepository: "org/repo",
      });

      const ok = await copySingleResult(result);
      expect(ok).toBe(true);
      expect(clipboardText).toContain("Session: Test Session");
      expect(clipboardText).toContain("error · tool: compile · turn 5");
      expect(clipboardText).toContain("Repo: org/repo");
    });

    it("omits optional fields when not available", async () => {
      const { copySingleResult } = useSearchClipboard();
      const result = makeResult({
        sessionSummary: null,
        toolName: null,
        turnNumber: null as unknown as number,
        sessionRepository: null,
      });

      const ok = await copySingleResult(result);
      expect(ok).toBe(true);
      expect(clipboardText).not.toContain("Session:");
      expect(clipboardText).not.toContain("tool:");
      expect(clipboardText).not.toContain("turn");
      expect(clipboardText).not.toContain("Repo:");
    });

    it("returns false when clipboard API fails", async () => {
      (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("denied"),
      );
      const { copySingleResult } = useSearchClipboard();

      const ok = await copySingleResult(makeResult());
      expect(ok).toBe(false);
    });
  });
});
