// ─── Export & Import Types ────────────────────────────────────────
// Types for session export/import configuration, results, previews,
// and side-by-side session comparison.

// ── Section IDs ──────────────────────────────────────────────────

/** Matches Rust `SectionId` enum variants (kebab-case for IPC). */
export type SectionId =
  | 'conversation'
  | 'events'
  | 'todos'
  | 'plan'
  | 'checkpoints'
  | 'rewind_snapshots'
  | 'metrics'
  | 'incidents'
  | 'health'
  | 'custom_tables'
  | 'parse_diagnostics';

/** All available section IDs. */
export const ALL_SECTION_IDS: readonly SectionId[] = [
  'conversation',
  'events',
  'todos',
  'plan',
  'checkpoints',
  'rewind_snapshots',
  'metrics',
  'incidents',
  'health',
  'custom_tables',
  'parse_diagnostics',
] as const;

/** Human-readable labels for each section. */
export const SECTION_LABELS: Record<SectionId, string> = {
  conversation: 'Conversation',
  events: 'Raw Events',
  todos: 'Todos',
  plan: 'Plan',
  checkpoints: 'Checkpoints',
  rewind_snapshots: 'Rewind Snapshots',
  metrics: 'Metrics',
  incidents: 'Incidents',
  health: 'Health',
  custom_tables: 'Custom Tables',
  parse_diagnostics: 'Parse Diagnostics',
};

// ── Export Format ────────────────────────────────────────────────

export type ExportFormat = 'json' | 'markdown' | 'csv';

// ── Conflict Strategy (for import) ──────────────────────────────

export type ConflictStrategy = 'skip' | 'overwrite' | 'rename';

// ── Export Configuration ────────────────────────────────────────

/** Export configuration sent to the Tauri `export_sessions` command. */
export interface ExportConfig {
  /** Session IDs to export. */
  sessionIds: string[];
  /** Output format. */
  format: ExportFormat;
  /** Which sections to include. Empty = all. */
  sections: SectionId[];
  /** Filesystem path to write the export to. */
  outputPath: string;
}

/** Result returned from `export_sessions`. Matches Rust `ExportSessionsResult`. */
export interface ExportResult {
  /** Number of sessions included in the export. */
  sessionsExported: number;
  /** Filesystem path where the export was written. */
  filePath: string;
  /** Size of the output file in bytes. */
  fileSizeBytes: number;
  /** ISO-8601 timestamp of the export. */
  exportedAt: string;
}

// ── Export Preview ──────────────────────────────────────────────

/** Arguments for the `preview_export` command. */
export interface ExportPreviewRequest {
  sessionId: string;
  format: ExportFormat;
  sections: SectionId[];
  /** Max characters to return. Defaults to 50_000 on the backend. */
  maxLength?: number;
}

/** Result returned from `preview_export`. Matches Rust `ExportPreviewResult`. */
export interface ExportPreviewResult {
  /** Rendered content (JSON, Markdown, or CSV). */
  content: string;
  /** Format that was rendered. */
  format: string;
  /** Estimated total output size in bytes. */
  estimatedSizeBytes: number;
  /** Number of sections included. */
  sectionCount: number;
}

// ── Session Sections Info ──────────────────────────────────────

/** Per-session section availability. Matches Rust `SessionSectionsInfo`. */
export interface SessionSectionsInfo {
  sessionId: string;
  hasConversation: boolean;
  hasEvents: boolean;
  hasTodos: boolean;
  hasPlan: boolean;
  hasCheckpoints: boolean;
  hasMetrics: boolean;
  hasHealth: boolean;
  hasIncidents: boolean;
  hasRewindSnapshots: boolean;
  hasCustomTables: boolean;
  eventCount: number | null;
  turnCount: number | null;
}

// ── Import Preview ─────────────────────────────────────────────

/** Result returned from `preview_import`. Matches Rust `ImportPreviewResult`. */
export interface ImportPreviewResult {
  /** Whether the archive is valid for import. */
  valid: boolean;
  /** Validation issues (errors and warnings). */
  issues: ImportIssue[];
  /** Sessions found in the archive. */
  sessions: ImportSessionPreview[];
  /** Schema version of the archive (e.g. "1.0"). */
  schemaVersion: string;
  /** Whether the archive needs migration before import. */
  needsMigration: boolean;
}

/** A single validation issue. Matches Rust `ImportIssue`. */
export interface ImportIssue {
  severity: 'error' | 'warning' | 'info';
  message: string;
}

/** Summary of a session found inside an import archive. */
export interface ImportSessionPreview {
  id: string;
  summary: string | null;
  repository: string | null;
  createdAt: string | null;
  sectionCount: number;
  alreadyExists: boolean;
}

// ── Import Configuration / Result ──────────────────────────────

/** Arguments for the `import_sessions` command. */
export interface ImportConfig {
  /** Path to the `.tpx.json` file. */
  filePath: string;
  /** How to handle sessions that already exist locally. */
  conflictStrategy: ConflictStrategy;
  /** Specific session IDs to import. Empty = all. */
  sessionFilter: string[];
}

/** Result returned from `import_sessions`. Matches Rust `ImportSessionsResult`. */
export interface ImportResult {
  importedCount: number;
  skippedCount: number;
  errors: string[];
}

// ─── Comparison ───────────────────────────────────────────────────

/** Result of comparing two sessions */
export interface ComparisonResult {
  /** Session A details */
  sessionA: {
    id: string;
    summary: string;
    model: string;
    duration: number;
    turns: number;
    tokens: number;
    cost: number;
    toolCalls: number;
    successRate: number;
    filesModified: number;
    linesChanged: number;
    healthScore: number;
  };
  /** Session B details */
  sessionB: {
    id: string;
    summary: string;
    model: string;
    duration: number;
    turns: number;
    tokens: number;
    cost: number;
    toolCalls: number;
    successRate: number;
    filesModified: number;
    linesChanged: number;
    healthScore: number;
  };
  /** Per-model usage breakdown for comparison */
  modelUsage: {
    sessionA: Array<{ model: string; tokens: number; requests: number }>;
    sessionB: Array<{ model: string; tokens: number; requests: number }>;
  };
}
