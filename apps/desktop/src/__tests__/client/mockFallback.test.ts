/**
 * Integration tests for @tracepilot/client mock-fallback behaviour.
 *
 * In jsdom (vitest) there is no __TAURI_INTERNALS__ on window, so
 * isTauri() returns false and every invoke() routes through getMockData().
 * We deliberately do NOT vi.mock("@tracepilot/client") here — the real
 * module is imported so the mock-data path is exercised end-to-end.
 *
 * These tests target the 10 commands that were previously missing from
 * mockMap and therefore threw "[STUB] No mock data for command: …".
 */

import type { ContextSnippet, FtsHealthInfo } from "@tracepilot/client";
import {
  exportSessions,
  ftsHealth,
  ftsIntegrityCheck,
  ftsOptimize,
  getInstallType,
  getResultContext,
  getSessionSections,
  importSessions,
  previewExport,
  previewImport,
} from "@tracepilot/client";
import { describe, expect, it } from "vitest";

// ── FTS Commands ──────────────────────────────────────────────

describe("FTS mock fallback", () => {
  it("ftsIntegrityCheck resolves to a string", async () => {
    const result = await ftsIntegrityCheck();
    expect(typeof result).toBe("string");
    expect(result).toBe("ok");
  });

  it("ftsOptimize resolves to a string", async () => {
    const result = await ftsOptimize();
    expect(typeof result).toBe("string");
    expect(result).toBe("ok");
  });

  it("ftsHealth resolves to a valid FtsHealthInfo", async () => {
    const h: FtsHealthInfo = await ftsHealth();
    expect(h).toMatchObject({
      inSync: true,
      pendingSessions: 0,
    });
    expect(typeof h.totalContentRows).toBe("number");
    expect(typeof h.ftsIndexRows).toBe("number");
    expect(typeof h.indexedSessions).toBe("number");
    expect(typeof h.totalSessions).toBe("number");
    expect(typeof h.dbSizeBytes).toBe("number");
    expect(Array.isArray(h.contentTypes)).toBe(true);
    // Each entry is a [string, number] tuple
    for (const entry of h.contentTypes) {
      expect(typeof entry[0]).toBe("string");
      expect(typeof entry[1]).toBe("number");
    }
  });

  it("getResultContext resolves to a [before, after] tuple", async () => {
    const [before, after]: [ContextSnippet[], ContextSnippet[]] = await getResultContext(1);
    expect(Array.isArray(before)).toBe(true);
    expect(Array.isArray(after)).toBe(true);
  });
});

// ── Export / Import Commands ──────────────────────────────────

describe("Export mock fallback", () => {
  it("exportSessions resolves to an ExportResult", async () => {
    const result = await exportSessions({
      sessionIds: ["sess-1"],
      format: "json",
      sections: ["conversation"],
      outputPath: "/out.json",
    });
    expect(typeof result.sessionsExported).toBe("number");
    expect(typeof result.filePath).toBe("string");
    expect(typeof result.fileSizeBytes).toBe("number");
    expect(typeof result.exportedAt).toBe("string");
  });

  it("previewExport resolves to an ExportPreviewResult", async () => {
    const result = await previewExport({
      sessionId: "sess-1",
      format: "markdown",
      sections: ["conversation"],
    });
    expect(typeof result.content).toBe("string");
    expect(typeof result.format).toBe("string");
    expect(typeof result.estimatedSizeBytes).toBe("number");
    expect(typeof result.sectionCount).toBe("number");
  });

  it("getSessionSections resolves to a SessionSectionsInfo", async () => {
    const info = await getSessionSections("sess-1");
    expect(typeof info.sessionId).toBe("string");
    expect(typeof info.hasConversation).toBe("boolean");
    expect(typeof info.hasEvents).toBe("boolean");
    expect(typeof info.hasTodos).toBe("boolean");
    expect(typeof info.hasPlan).toBe("boolean");
    expect(typeof info.hasCheckpoints).toBe("boolean");
    expect(typeof info.hasMetrics).toBe("boolean");
    expect(typeof info.hasIncidents).toBe("boolean");
    expect(typeof info.hasRewindSnapshots).toBe("boolean");
    expect(typeof info.hasCustomTables).toBe("boolean");
  });
});

describe("Import mock fallback", () => {
  it("previewImport resolves to a valid ImportPreviewResult", async () => {
    const result = await previewImport("/path/to/file.tpx.json");
    expect(result.valid).toBe(true);
    expect(Array.isArray(result.issues)).toBe(true);
    expect(Array.isArray(result.sessions)).toBe(true);
    expect(result.sessions.length).toBeGreaterThan(0);
    expect(typeof result.schemaVersion).toBe("string");
    expect(typeof result.needsMigration).toBe("boolean");
    // Verify session preview shape
    const sess = result.sessions[0];
    expect(typeof sess.id).toBe("string");
    expect(typeof sess.sectionCount).toBe("number");
    expect(typeof sess.alreadyExists).toBe("boolean");
  });

  it("importSessions resolves to an ImportResult", async () => {
    const result = await importSessions({
      filePath: "/path/to/file.tpx.json",
      conflictStrategy: "skip",
      sessionFilter: [],
    });
    expect(typeof result.importedCount).toBe("number");
    expect(typeof result.skippedCount).toBe("number");
    expect(Array.isArray(result.warnings)).toBe(true);
  });
});

// ── System Info Commands ──────────────────────────────────────

describe("System info mock fallback", () => {
  it("getInstallType resolves to a string", async () => {
    const result = await getInstallType();
    expect(typeof result).toBe("string");
    expect(result).toBe("source");
  });
});
