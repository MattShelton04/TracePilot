// ─── Export & Comparison Types ────────────────────────────────────
// Types for session export configuration, results, and side-by-side
// session comparison.

/** Export configuration */
export interface ExportConfig {
  /** Session IDs to export */
  sessionIds: string[];
  /** Export format */
  format: 'json' | 'csv' | 'markdown';
  /** Include conversation data */
  includeConversation: boolean;
  /** Include events data */
  includeEvents: boolean;
  /** Include metrics data */
  includeMetrics: boolean;
  /** Include todo items */
  includeTodos: boolean;
  /** Output destination path */
  destination: string;
}

/** Export result */
export interface ExportResult {
  /** Whether export succeeded */
  success: boolean;
  /** Output file path */
  filePath?: string;
  /** Error message if failed */
  error?: string;
  /** Number of sessions exported */
  sessionsExported: number;
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
