import type {
  ExportConfig,
  ExportPreviewRequest,
  ExportPreviewResult,
  ExportResult,
  ImportConfig,
  ImportPreviewResult,
  ImportResult,
} from "@tracepilot/types";

import { invoke } from "./internal/core.js";

// ── Export / Import Commands ──────────────────────────────────

/** Export one or more sessions in the specified format. */
export async function exportSessions(config: ExportConfig): Promise<ExportResult> {
  return invoke<ExportResult>("export_sessions", {
    sessionIds: config.sessionIds,
    format: config.format,
    sections: config.sections,
    outputPath: config.outputPath,
    includeSubagentInternals: config.contentDetail?.includeSubagentInternals,
    includeToolDetails: config.contentDetail?.includeToolDetails,
    includeFullToolResults: config.contentDetail?.includeFullToolResults,
    anonymizePaths: config.redaction?.anonymizePaths,
    stripSecrets: config.redaction?.stripSecrets,
    stripPii: config.redaction?.stripPii,
  });
}

/** Get a live preview of what an export would look like. */
export async function previewExport(request: ExportPreviewRequest): Promise<ExportPreviewResult> {
  return invoke<ExportPreviewResult>("preview_export", {
    sessionId: request.sessionId,
    format: request.format,
    sections: request.sections,
    maxBytes: request.maxLength,
    includeSubagentInternals: request.contentDetail?.includeSubagentInternals,
    includeToolDetails: request.contentDetail?.includeToolDetails,
    includeFullToolResults: request.contentDetail?.includeFullToolResults,
    anonymizePaths: request.redaction?.anonymizePaths,
    stripSecrets: request.redaction?.stripSecrets,
    stripPii: request.redaction?.stripPii,
  });
}

/** Preview a `.tpx.json` file before importing. */
export async function previewImport(filePath: string): Promise<ImportPreviewResult> {
  return invoke<ImportPreviewResult>("preview_import", { filePath });
}

/** Import sessions from a `.tpx.json` file. */
export async function importSessions(config: ImportConfig): Promise<ImportResult> {
  return invoke<ImportResult>("import_sessions", {
    filePath: config.filePath,
    conflictStrategy: config.conflictStrategy,
    sessionFilter: config.sessionFilter,
  });
}

/** Export a session folder as a raw zip archive. */
export async function exportSessionFolderZip(sessionId: string, destPath: string): Promise<void> {
  return invoke("export_session_folder_zip", { sessionId, destPath });
}
