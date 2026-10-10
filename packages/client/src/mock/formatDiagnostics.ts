import type { SourceFormatDiagnostics } from "../generated/bindings.js";

// Format drift recorded while indexing (Settings → Logs & Diagnostics).

export const MOCK_CLAUDE_FORMAT_DIAGNOSTICS: SourceFormatDiagnostics = {
  sessions: 3,
  unmappedRecordTypes: [{ name: "brand-new-record", sessions: 1, records: 2 }],
  unmappedAttachmentTypes: [],
  versions: [
    { name: "2.1.280", sessions: 2, records: 140 },
    { name: "2.1.289", sessions: 3, records: 212 },
  ],
};

// Enough versions to scroll inside their table.
export const MOCK_COPILOT_FORMAT_DIAGNOSTICS: SourceFormatDiagnostics = {
  sessions: 47,
  unmappedRecordTypes: [{ name: "session.brand_new_event", sessions: 2, records: 5 }],
  unmappedAttachmentTypes: [],
  versions: Array.from({ length: 12 }, (_, i) => ({
    name: `1.0.${80 + i}`,
    sessions: 3 + (i % 4),
    records: 2 + (i % 3),
  })),
};
