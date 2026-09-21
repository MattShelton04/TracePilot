// Mirrors the session-store enrichment DTOs in
// `crates/tracepilot-tauri-bindings/src/types.rs`, which wrap
// `tracepilot_indexer::index_db::enrichment` and
// `tracepilot_core::session_store`.
//
// This data comes from the Copilot CLI's own `session-store.db`, an optional
// local file. Three states must never collapse into one in the UI:
//   - the user turned the feature off (`enabled: false`)
//   - no source is installed or readable (`available: false`)
//   - the source was read and recorded nothing (`available: true`, empty)
//
// Exact decimals — nano AI units and per-batch rates — arrive as strings. A
// nano-AIU total routinely exceeds `Number.MAX_SAFE_INTEGER` and a rate is
// routinely a decimal that binary floating point cannot hold, so parsing
// either with `Number()` would corrupt the very figure being explained.
// Format them from the string, or divide only for a bounded display value.

/** Whether the bound source can be read at all. */
export type StoreAvailability =
  | "disabled"
  | "missing"
  | "ready"
  | "busy"
  | "unreadable"
  | "incompatible";

/** How current the cached enrichment is relative to the source. */
export type StoreFreshness = "current" | "stale" | "refreshing";

/** Whether the itemised billing entries reproduced the recorded charge. */
export type BillingCheck = "exact" | "differs" | "notComparable" | "incomputable";

/** Whether a request's billing array could be read, and how completely. */
export type BillingItemsStatus = "complete" | "absent" | "partial" | "invalid";

/** Result of comparing recorded requests to the session's shutdown totals. */
export type ReconciliationStatus =
  | "unverified"
  | "reconciled"
  | "scopeDifference"
  | "partial"
  | "mismatch";

/** What a linked-work reference points at. */
export type WorkRefKind = "pullRequest" | "issue" | "gitRef" | (string & {});

/** How confidently a reference was tied to a repository. */
export type WorkRefResolution = "explicit" | "sessionContext" | "unresolved";

/** One itemised billing entry. `costPerBatch` is an exact decimal string. */
export interface StoredBillingItem {
  ordinal: number;
  /** `input`, `cache read`, `cache write`, `output`, or anything new. */
  tokenType: string;
  tokenCount: number | null;
  batchSize: number | null;
  costPerBatch: string | null;
  /**
   * Recorded billing model: the entry's own, else the request default.
   * Never the execution model, which would be inferred attribution.
   */
  billingModel: string | null;
}

/** One recorded model request. */
export interface StoredRequest {
  sourceId: string;
  generation: string;
  /** Row identity within one source generation. Not a provider request ID. */
  sourceRowId: number;
  sessionId: string;
  /** The source's own interaction counter, not a TracePilot turn index. */
  sourceTurnIndex: number | null;
  agentId: string | null;
  parentToolCallId: string | null;
  model: string;
  /** Includes the cache categories; not a "fresh tokens" figure. */
  inputTokens: number | null;
  /** Already includes reasoning tokens. Never add them again. */
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  reasoningTokens: number | null;
  /** Exact decimal string. Divide by 1e9 for displayed AI credits. */
  totalNanoAiu: string | null;
  requestMultiplier: string | null;
  /** Whole API-call duration; excludes unrelated tool runtime. */
  durationMs: number | null;
  timeToFirstTokenMs: number | null;
  /**
   * First *observable* output, including reasoning and tool-call output.
   * Not time to the first user-visible answer, and its difference from
   * `timeToFirstTokenMs` is not reasoning duration.
   */
  outputTtftMs: number | null;
  /** Reported average. Its reciprocal is not a visible-text token rate. */
  interTokenLatencyMs: number | null;
  /** `null` is a historical absence, not an implicit "user". */
  initiator: string | null;
  apiEndpoint: string | null;
  reasoningEffort: string | null;
  finishReason: string | null;
  contentFilterTriggered: boolean | null;
  copilotUsageModel: string | null;
  billingItemsStatus: BillingItemsStatus;
  billingCheck: BillingCheck;
  recordedAt: string | null;
  /** Source columns whose cells were unusable on this row. */
  invalidFields: string[];
  rowFingerprint: string;
  billingItems: StoredBillingItem[];
}

/** One page of the request ledger. */
export interface RequestLedgerPage {
  requests: StoredRequest[];
  /** Opaque page token. Echo it back; never construct one. */
  nextCursor: string | null;
  generation: string | null;
  /** False when no source is bound or the enrichment tables are absent. */
  available: boolean;
  /**
   * True when the supplied cursor belonged to a superseded generation.
   * Restart from the first page rather than mixing two versions of the
   * source.
   */
  cursorExpired: boolean;
}

/** One linked-work reference found in a session. */
export interface StoredWorkRef {
  identity: string;
  sessionId: string;
  sourceRowId: number | null;
  kind: WorkRefKind;
  /** The value exactly as recorded. */
  rawValue: string;
  normalizedValue: string;
  /** Host from the reference itself, never derived from a host *type*. */
  resolvedHost: string | null;
  resolvedRepository: string | null;
  /** The session's repository, when it supplied the context above. */
  candidateRepository: string | null;
  /** Only `explicit` may be presented as a verified link. */
  resolution: WorkRefResolution;
  /** 7–40 hex characters: a candidate commit, not proof one exists. */
  shaShaped: boolean;
  sourceTurnIndex: number | null;
  recordedAt: string | null;
}

/** Per-metric tally behind any aggregate. */
export interface FieldCoverage {
  valid: number;
  missing: number;
  invalid: number;
}

/** One session's refresh completeness. */
export interface SessionCoverageRow {
  sessionId: string;
  generation: string;
  availability: StoreAvailability;
  freshness: StoreFreshness;
  requestRows: number;
  requestRowsRejected: number;
  workRefRows: number;
  workRefRowsRejected: number;
  billingAbsent: number;
  billingPartial: number;
  billingInvalid: number;
  /** JSON object of per-metric `FieldCoverage`, keyed by metric name. */
  fieldCoverageJson: string | null;
  missingColumns: string[];
  reconciliationStatus: ReconciliationStatus | null;
  /** The accounting scope the verdict used, e.g. `excludingCompaction`. */
  reconciliationScope: string | null;
  reconciliationMetrics: string[];
  reconciliationDifferences: string | null;
  readAt: string;
  revision: number;
}

/** The bound source's state. */
export interface StoreSourceStatus {
  sourceId: string;
  dbPath: string;
  copilotHome: string;
  generation: string;
  capabilityFingerprint: string | null;
  /** Diagnostic only: seen at 1 and 8 for near-identical schemas. */
  sourceSchemaVersion: number | null;
  capabilities: string[];
  availability: StoreAvailability;
  statusDetail: string | null;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  revision: number;
  enrichmentVersion: number;
  sessionsWithRequests: number;
  totalRequests: number;
}

/** A latency metric's distribution over the rows that supplied it. */
export interface LatencyDistribution {
  median: number | null;
  /** Suppressed below the sample threshold; count and median remain. */
  p95: number | null;
  min: number | null;
  max: number | null;
  coverage: FieldCoverage;
}

/** Two different answers to "did the cache help?". */
export interface CacheReuse {
  requestsReportingReuse: number;
  requestsWithCounter: number;
  /** Sum of cache reads over sum of inputs, across identical rows. */
  tokenWeightedRatio: number | null;
  cacheReadTokens: number;
  inputTokens: number;
  /** Rows whose cache counters exceeded their input, excluded not clamped. */
  inconsistentRows: number;
}

/** Observed performance over a population of requests. */
export interface RequestPerformance {
  requestCount: number;
  sessionCount: number;
  durationMs: LatencyDistribution;
  timeToFirstTokenMs: LatencyDistribution;
  outputTtftMs: LatencyDistribution;
  interTokenLatencyMs: LatencyDistribution;
  cache: CacheReuse;
}

export interface SessionStoreStatusResponse {
  /** The stored preference. A missing store never rewrites it to false. */
  enabled: boolean;
  /** Where the store would be, whether or not it exists. */
  resolvedPath: string | null;
  source: StoreSourceStatus | null;
}

export interface SessionRequestUsageResponse {
  enabled: boolean;
  page: RequestLedgerPage;
  coverage: SessionCoverageRow | null;
}

export interface SessionWorkRefsResponse {
  enabled: boolean;
  /**
   * Whether a source was available to search. When false, say the source is
   * unavailable — never imply that no such work exists.
   */
  available: boolean;
  refs: StoredWorkRef[];
  sourceAvailability: StoreAvailability | null;
}

export interface RequestPerformanceResponse {
  enabled: boolean;
  available: boolean;
  performance: RequestPerformance | null;
  coverage: SessionCoverageRow | null;
}

/** Outcome of an explicit enrichment refresh. */
export interface EnrichmentRefreshResponse {
  availability: StoreAvailability;
  refreshed: number;
  unchanged: number;
  skipped: number;
  detail: string | null;
}

/** Filters accepted by the request ledger. */
export interface RequestUsageFilters {
  models?: string[];
  agentIds?: string[];
  initiators?: string[];
  reasoningEfforts?: string[];
  finishReasons?: string[];
  apiEndpoints?: string[];
  /**
   * `true` keeps requests recording a positive cache read, `false` those
   * recording zero. Requests whose counter was never recorded are in neither
   * population: "not recorded" is not "no reuse".
   */
  reportsCacheReuse?: boolean | null;
  fromDate?: string | null;
  toDate?: string | null;
}

/** One model's observed request performance. */
export interface ModelRequestPerformance {
  model: string;
  performance: RequestPerformance;
}

/**
 * Observed performance across sessions, overall and per model.
 *
 * These are **observational comparisons, not controlled benchmarks**. Prompt
 * sizes and agent roles vary enormously between sessions and can dominate any
 * difference between models, so this is never a quality ranking or a reason
 * to switch model.
 */
export interface RequestPerformanceReport {
  stale: boolean;
  lastSuccessAt: string | null;
  /**
   * False when no source is bound or the enrichment tables are absent —
   * which is not the same as a filter matching no requests.
   */
  available: boolean;
  overall: RequestPerformance | null;
  byModel: ModelRequestPerformance[];
  /** Sessions represented, so a one-session-dominated shape is visible. */
  sessionCount: number;
}

export interface ModelRequestPerformanceResponse {
  enabled: boolean;
  report: RequestPerformanceReport;
}

/**
 * One agent's own request figures within a session.
 *
 * Own totals only. Derive a branch total by summing descendants once, as the
 * Agents metrics UI already does — adding a branch total and its children
 * into a session total double-counts.
 */
export interface AgentRequestRollup {
  runKey: string | null;
  agentId: string | null;
  requestCount: number;
  /** Exact decimal string of own nano AI units. */
  ownNanoAiu: string | null;
  cacheReadTokens: number;
  inputTokens: number;
  /** Requests whose join to a run was not exact. Shown, never hidden. */
  unattributedRequests: number;
}

export interface AgentRequestRollupResponse {
  enabled: boolean;
  available: boolean;
  rollups: AgentRequestRollup[];
}

/** Filters for the cross-session performance comparison. */
export interface RequestPerformanceFilters {
  fromDate?: string | null;
  toDate?: string | null;
  repository?: string | null;
  models?: string[];
  reasoningEfforts?: string[];
  initiators?: string[];
  apiEndpoints?: string[];
}
