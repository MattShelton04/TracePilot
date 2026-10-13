import type { ExportPreviewResult, ImportPreviewResult, ImportResult } from "@tracepilot/types";
import { MOCK_EXPORT_RESULT } from "../export.js";
import type { MockRoutes } from "./route.js";

/** Commands from `export.ts`. */
export const EXPORT_ROUTES: MockRoutes = {
  export_sessions: () => MOCK_EXPORT_RESULT,
  preview_export: (): ExportPreviewResult => ({
    content: "# Export Preview\n\nNo content selected.",
    format: "markdown",
    estimatedSizeBytes: 42,
    sectionCount: 0,
  }),
  preview_import: (): ImportPreviewResult => ({
    valid: true,
    issues: [],
    sessions: [
      {
        id: "sess-imported-1",
        summary: "Imported session",
        repository: "tracepilot/app",
        createdAt: "2026-01-15T10:00:00Z",
        sectionCount: 5,
        alreadyExists: false,
      },
    ],
    schemaVersion: "1.0",
    needsMigration: false,
  }),
  import_sessions: (): ImportResult => ({ importedCount: 1, skippedCount: 0, warnings: [] }),
};
