import type { SessionSource } from "@tracepilot/types";

/** A list of `SourceFormatDiagnostics`. */
export type FormatDiagnosticsList = "unmappedRecordTypes" | "unmappedAttachmentTypes" | "versions";

export interface FormatDiagnosticsGroup {
  list: FormatDiagnosticsList;
  title: string;
  column: string;
  empty: string;
}

export interface FormatDiagnosticsSource {
  source: SessionSource;
  title: string;
  groups: FormatDiagnosticsGroup[];
}

const VERSIONS_EMPTY = "None recorded yet. Versions appear after the next index.";

/** The lists each source reports, in display order. */
export const COPILOT_FORMAT_DIAGNOSTICS: FormatDiagnosticsSource = {
  source: "copilot",
  title: "Copilot CLI",
  groups: [
    {
      list: "unmappedRecordTypes",
      title: "Unknown event types",
      column: "Event type",
      empty: "None. Every event type is known.",
    },
    { list: "versions", title: "Copilot CLI versions", column: "Version", empty: VERSIONS_EMPTY },
  ],
};

export const CLAUDE_CODE_FORMAT_DIAGNOSTICS: FormatDiagnosticsSource = {
  source: "claudeCode",
  title: "Claude Code",
  groups: [
    {
      list: "unmappedRecordTypes",
      title: "Unmapped record types",
      column: "Type",
      empty: "None. Every record type is mapped.",
    },
    {
      list: "unmappedAttachmentTypes",
      title: "Unmapped attachment types",
      column: "Type",
      empty: "None. Every attachment type is known.",
    },
    { list: "versions", title: "Claude Code versions", column: "Version", empty: VERSIONS_EMPTY },
  ],
};
