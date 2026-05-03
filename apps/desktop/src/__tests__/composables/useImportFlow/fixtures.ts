import type { ImportPreviewResult, ImportResult } from "@tracepilot/types";

export function makePreviewResult(
  overrides: Partial<ImportPreviewResult> = {},
): ImportPreviewResult {
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

export function makeImportResult(overrides: Partial<ImportResult> = {}): ImportResult {
  return {
    importedCount: 2,
    skippedCount: 0,
    warnings: [],
    ...overrides,
  };
}
