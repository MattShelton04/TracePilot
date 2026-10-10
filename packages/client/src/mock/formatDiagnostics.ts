import type { SourceFormatDiagnostics } from "../generated/bindings.js";

// Format drift recorded while indexing (Settings → Claude Code). Only
// Claude Code reports any; Copilot's is always empty.

export const MOCK_CLAUDE_FORMAT_DIAGNOSTICS: SourceFormatDiagnostics = {
  sessions: 3,
  unmappedRecordTypes: [{ name: "brand-new-record", sessions: 1, records: 2 }],
  unmappedAttachmentTypes: [],
  versions: [
    { name: "2.1.280", sessions: 2, records: 140 },
    { name: "2.1.289", sessions: 3, records: 212 },
  ],
};

export const MOCK_COPILOT_FORMAT_DIAGNOSTICS: SourceFormatDiagnostics = {
  sessions: 47,
  unmappedRecordTypes: [],
  unmappedAttachmentTypes: [],
  versions: [],
};
