import type { ImportPreviewResult, ImportResult } from "@tracepilot/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────
vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../mocks/client");
  return {
    ...createClientMock(),
    previewImport: vi.fn(),
    importSessions: vi.fn(),
  };
});

vi.mock("@/utils/logger", () => ({
  logError: vi.fn(),
  logInfo: vi.fn(),
}));

import { importSessions, previewImport } from "@tracepilot/client";
import { useImportFlow } from "../../composables/useImportFlow";

const mockPreviewImport = previewImport as ReturnType<typeof vi.fn>;
const mockImportSessions = importSessions as ReturnType<typeof vi.fn>;

// ── Helpers ────────────────────────────────────────────────────

function makePreviewResult(overrides: Partial<ImportPreviewResult> = {}): ImportPreviewResult {
  return {
    valid: true,
    sessions: [
      {
        id: "sess-1",
        summary: "Session 1",
        repository: null,
        createdAt: "2026-01-01",
        sectionCount: 3,
        alreadyExists: false,
      },
      {
        id: "sess-2",
        summary: "Session 2",
        repository: null,
        createdAt: "2026-01-02",
        sectionCount: 3,
        alreadyExists: false,
      },
    ],
    issues: [],
    schemaVersion: "1.0",
    needsMigration: false,
    ...overrides,
  };
}

function makeImportResult(overrides: Partial<ImportResult> = {}): ImportResult {
  return {
    importedCount: 2,
    skippedCount: 0,
    warnings: [],
    ...overrides,
  } as ImportResult;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  // Ensure we're not in Tauri environment for most tests
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useImportFlow", () => {
  // ── Initial State ──────────────────────────────────────────

  describe("initial state", () => {
    it("starts at the select step", () => {
      const flow = useImportFlow();
      expect(flow.step.value).toBe("select");
    });

    it("has empty file path and name", () => {
      const flow = useImportFlow();
      expect(flow.filePath.value).toBe("");
      expect(flow.fileName.value).toBe("");
    });

    it("has no preview or error", () => {
      const flow = useImportFlow();
      expect(flow.preview.value).toBeNull();
      expect(flow.error.value).toBeNull();
    });

    it("defaults conflict strategy to skip", () => {
      const flow = useImportFlow();
      expect(flow.conflictStrategy.value).toBe("skip");
    });

    it("has empty session selection", () => {
      const flow = useImportFlow();
      expect(flow.selectedSessions.value).toEqual([]);
    });

    it("has zero progress and counts", () => {
      const flow = useImportFlow();
      expect(flow.importProgress.value).toBe(0);
      expect(flow.importedCount.value).toBe(0);
      expect(flow.skippedCount.value).toBe(0);
      expect(flow.importErrors.value).toEqual([]);
    });
  });

  // ── Computed Properties ────────────────────────────────────

  describe("hasErrors", () => {
    it("returns false when preview is null", () => {
      const flow = useImportFlow();
      expect(flow.hasErrors.value).toBe(false);
    });

    it("returns false when preview has no error-severity issues", async () => {
      mockPreviewImport.mockResolvedValue(
        makePreviewResult({
          issues: [{ severity: "warning", message: "Minor issue" }],
        }),
      );

      const flow = useImportFlow();
      flow.filePath.value = "/some/file.json";
      await flow.validateFile();

      expect(flow.hasErrors.value).toBe(false);
    });

    it("returns true when preview has error-severity issues", async () => {
      mockPreviewImport.mockResolvedValue(
        makePreviewResult({
          issues: [{ severity: "error", message: "Fatal issue" }],
        }),
      );

      const flow = useImportFlow();
      flow.filePath.value = "/some/file.json";
      await flow.validateFile();

      expect(flow.hasErrors.value).toBe(true);
    });
  });

  describe("canImport", () => {
    it("returns false at initial state", () => {
      const flow = useImportFlow();
      expect(flow.canImport.value).toBe(false);
    });

    it("returns true when step is review, no errors, and sessions selected", async () => {
      mockPreviewImport.mockResolvedValue(makePreviewResult());

      const flow = useImportFlow();
      flow.filePath.value = "/file.json";
      await flow.validateFile();

      expect(flow.step.value).toBe("review");
      expect(flow.hasErrors.value).toBe(false);
      expect(flow.selectedSessions.value.length).toBeGreaterThan(0);
      expect(flow.canImport.value).toBe(true);
    });

    it("returns false when step is review but no sessions selected", async () => {
      mockPreviewImport.mockResolvedValue(makePreviewResult());

      const flow = useImportFlow();
      flow.filePath.value = "/file.json";
      await flow.validateFile();
      flow.selectedSessions.value = [];

      expect(flow.canImport.value).toBe(false);
    });

    it("returns false when step is review but has errors", async () => {
      mockPreviewImport.mockResolvedValue(
        makePreviewResult({
          issues: [{ severity: "error", message: "Bad" }],
        }),
      );

      const flow = useImportFlow();
      flow.filePath.value = "/file.json";
      await flow.validateFile();

      expect(flow.canImport.value).toBe(false);
    });
  });

  // ── toggleSession ──────────────────────────────────────────

  describe("toggleSession", () => {
    it("adds a session to the selection", () => {
      const flow = useImportFlow();
      flow.toggleSession("sess-1");
      expect(flow.selectedSessions.value).toContain("sess-1");
    });

    it("removes a session that is already selected", () => {
      const flow = useImportFlow();
      flow.toggleSession("sess-1");
      flow.toggleSession("sess-1");
      expect(flow.selectedSessions.value).not.toContain("sess-1");
    });

    it("add and remove cycle returns to original state", () => {
      const flow = useImportFlow();
      const before = [...flow.selectedSessions.value];
      flow.toggleSession("sess-1");
      flow.toggleSession("sess-1");
      expect(flow.selectedSessions.value).toEqual(before);
    });

    it("handles multiple sessions independently", () => {
      const flow = useImportFlow();
      flow.toggleSession("sess-1");
      flow.toggleSession("sess-2");
      expect(flow.selectedSessions.value).toEqual(["sess-1", "sess-2"]);

      flow.toggleSession("sess-1");
      expect(flow.selectedSessions.value).toEqual(["sess-2"]);
    });
  });

  // ── reset ──────────────────────────────────────────────────

  describe("reset", () => {
    it("restores all state to initial values", async () => {
      mockPreviewImport.mockResolvedValue(makePreviewResult());

      const flow = useImportFlow();
      flow.filePath.value = "/file.json";
      await flow.validateFile();

      // State has advanced
      expect(flow.step.value).toBe("review");

      flow.reset();

      expect(flow.step.value).toBe("select");
      expect(flow.filePath.value).toBe("");
      expect(flow.fileName.value).toBe("");
      expect(flow.preview.value).toBeNull();
      expect(flow.error.value).toBeNull();
      expect(flow.conflictStrategy.value).toBe("skip");
      expect(flow.selectedSessions.value).toEqual([]);
      expect(flow.importProgress.value).toBe(0);
      expect(flow.importedCount.value).toBe(0);
      expect(flow.skippedCount.value).toBe(0);
      expect(flow.importErrors.value).toEqual([]);
    });

    it("invalidates in-flight validation requests", async () => {
      // Set up a validation that will resolve later
      let resolvePreview!: (v: ImportPreviewResult) => void;
      mockPreviewImport.mockReturnValue(
        new Promise<ImportPreviewResult>((resolve) => {
          resolvePreview = resolve;
        }),
      );

      const flow = useImportFlow();
      flow.filePath.value = "/file.json";
      const validatePromise = flow.validateFile();

      // Reset while validation is in-flight
      flow.reset();

      // Now resolve the stale validation
      resolvePreview(makePreviewResult());
      await validatePromise;

      // State should remain at initial (stale response discarded)
      expect(flow.step.value).toBe("select");
      expect(flow.preview.value).toBeNull();
    });
  });

  // ── validateFile ───────────────────────────────────────────

  describe("validateFile", () => {
    it("early-returns without changing state when filePath is empty", async () => {
      const flow = useImportFlow();
      await flow.validateFile();

      expect(flow.step.value).toBe("select");
      expect(mockPreviewImport).not.toHaveBeenCalled();
    });

    it("transitions to review on successful validation", async () => {
      const previewResult = makePreviewResult();
      mockPreviewImport.mockResolvedValue(previewResult);

      const flow = useImportFlow();
      flow.filePath.value = "/test/export.tpx.json";
      await flow.validateFile();

      expect(flow.step.value).toBe("review");
      expect(flow.preview.value).toEqual(previewResult);
      expect(flow.error.value).toBeNull();
    });

    it("auto-selects all sessions from the preview", async () => {
      mockPreviewImport.mockResolvedValue(makePreviewResult());

      const flow = useImportFlow();
      flow.filePath.value = "/file.json";
      await flow.validateFile();

      expect(flow.selectedSessions.value).toEqual(["sess-1", "sess-2"]);
    });

    it("returns to select step on validation error", async () => {
      mockPreviewImport.mockRejectedValue(new Error("Invalid format"));

      const flow = useImportFlow();
      flow.filePath.value = "/file.json";
      await flow.validateFile();

      expect(flow.step.value).toBe("select");
      expect(flow.error.value).toBe("Invalid format");
      expect(flow.preview.value).toBeNull();
    });

    it("handles non-Error rejection", async () => {
      mockPreviewImport.mockRejectedValue("raw string error");

      const flow = useImportFlow();
      flow.filePath.value = "/file.json";
      await flow.validateFile();

      expect(flow.error.value).toBe("raw string error");
    });

    it("discards stale responses from rapid file selections", async () => {
      let resolveFirst!: (v: ImportPreviewResult) => void;
      let resolveSecond!: (v: ImportPreviewResult) => void;

      mockPreviewImport
        .mockReturnValueOnce(
          new Promise<ImportPreviewResult>((resolve) => {
            resolveFirst = resolve;
          }),
        )
        .mockReturnValueOnce(
          new Promise<ImportPreviewResult>((resolve) => {
            resolveSecond = resolve;
          }),
        );

      const flow = useImportFlow();
      flow.filePath.value = "/first.json";
      const first = flow.validateFile();

      flow.filePath.value = "/second.json";
      const second = flow.validateFile();

      // Resolve second first, then first (out of order)
      const secondResult = makePreviewResult({
        sessions: [
          {
            id: "new",
            summary: "New",
            repository: null,
            createdAt: "2026-01-03",
            sectionCount: 2,
            alreadyExists: false,
          },
        ],
      });
      resolveSecond(secondResult);
      await second;

      // Now the stale first resolves
      resolveFirst(makePreviewResult());
      await first;

      // Only the second (latest) result should be applied
      expect(flow.selectedSessions.value).toEqual(["new"]);
    });
  });

  // ── executeImport ──────────────────────────────────────────

  describe("executeImport", () => {
    async function setupForImport() {
      mockPreviewImport.mockResolvedValue(makePreviewResult());
      const flow = useImportFlow();
      flow.filePath.value = "/file.json";
      await flow.validateFile();
      return flow;
    }

    it("is a no-op when canImport is false", async () => {
      const flow = useImportFlow();
      // canImport is false (step is 'select')
      await flow.executeImport();

      expect(flow.step.value).toBe("select");
      expect(mockImportSessions).not.toHaveBeenCalled();
    });

    it("transitions to complete on successful import", async () => {
      const flow = await setupForImport();
      mockImportSessions.mockResolvedValue(makeImportResult());

      await flow.executeImport();

      expect(flow.step.value).toBe("complete");
      expect(flow.importProgress.value).toBe(100);
      expect(flow.importedCount.value).toBe(2);
      expect(flow.skippedCount.value).toBe(0);
      expect(flow.importErrors.value).toEqual([]);
    });

    it("returns to review on import failure", async () => {
      const flow = await setupForImport();
      mockImportSessions.mockRejectedValue(new Error("Disk full"));

      await flow.executeImport();

      expect(flow.step.value).toBe("review");
      expect(flow.error.value).toBe("Disk full");
      expect(flow.importProgress.value).toBe(0);
    });

    it("passes conflict strategy and selected sessions to backend", async () => {
      const flow = await setupForImport();
      flow.conflictStrategy.value = "replace";
      flow.selectedSessions.value = ["sess-1"];
      mockImportSessions.mockResolvedValue(makeImportResult());

      await flow.executeImport();

      expect(mockImportSessions).toHaveBeenCalledWith({
        filePath: "/file.json",
        conflictStrategy: "replace",
        sessionFilter: ["sess-1"],
      });
    });

    it("simulates progress while waiting for backend", async () => {
      const flow = await setupForImport();

      let resolveImport!: (v: ImportResult) => void;
      mockImportSessions.mockReturnValue(
        new Promise<ImportResult>((resolve) => {
          resolveImport = resolve;
        }),
      );

      const importPromise = flow.executeImport();

      // Progress should advance after interval ticks
      expect(flow.step.value).toBe("importing");
      expect(flow.importProgress.value).toBe(0);

      // Advance fake timers to trigger progress updates
      vi.advanceTimersByTime(900); // 3 intervals of 300ms
      expect(flow.importProgress.value).toBeGreaterThan(0);
      expect(flow.importProgress.value).toBeLessThanOrEqual(90);

      // Complete the import
      resolveImport(makeImportResult());
      await importPromise;

      expect(flow.importProgress.value).toBe(100);
    });

    it("reports warnings from import result", async () => {
      const flow = await setupForImport();
      mockImportSessions.mockResolvedValue(
        makeImportResult({
          importedCount: 1,
          skippedCount: 1,
          warnings: ["Session sess-2 already exists"],
        }),
      );

      await flow.executeImport();

      expect(flow.importedCount.value).toBe(1);
      expect(flow.skippedCount.value).toBe(1);
      expect(flow.importErrors.value).toEqual(["Session sess-2 already exists"]);
    });
  });

  // ── browseFile ─────────────────────────────────────────────

  describe("browseFile", () => {
    it("falls back to prompt when not in Tauri environment", async () => {
      const mockPrompt = vi.fn().mockReturnValue("/path/to/file.tpx.json");
      vi.stubGlobal("prompt", mockPrompt);
      mockPreviewImport.mockResolvedValue(makePreviewResult());

      const flow = useImportFlow();
      await flow.browseFile();

      expect(mockPrompt).toHaveBeenCalled();
      expect(flow.filePath.value).toBe("/path/to/file.tpx.json");
      expect(flow.fileName.value).toBe("file.tpx.json");

      vi.unstubAllGlobals();
    });

    it("does nothing when prompt is cancelled", async () => {
      vi.stubGlobal("prompt", vi.fn().mockReturnValue(null));

      const flow = useImportFlow();
      await flow.browseFile();

      expect(flow.filePath.value).toBe("");
      expect(mockPreviewImport).not.toHaveBeenCalled();

      vi.unstubAllGlobals();
    });

    it("trims whitespace from prompt input", async () => {
      vi.stubGlobal("prompt", vi.fn().mockReturnValue("  /path/file.json  "));
      mockPreviewImport.mockResolvedValue(makePreviewResult());

      const flow = useImportFlow();
      await flow.browseFile();

      expect(flow.filePath.value).toBe("/path/file.json");

      vi.unstubAllGlobals();
    });
  });
});
