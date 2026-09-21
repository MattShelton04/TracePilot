-- Optional enrichment derived from the Copilot CLI's cross-session store
-- (see tracepilot_core::session_store). These tables cache per-request
-- billing, timing and cache counters plus extracted PR/issue/commit
-- references that `events.jsonl` does not persist.
--
-- Three properties separate these from every other child table:
--
--   1. They are NOT in session_writer::child_rows::DELETE_SQLS. A baseline
--      reindex fires whenever the event log changes, and it cannot
--      repopulate them — the external store may be missing or locked at that
--      moment. Deleting them there would destroy data on every unrelated
--      edit. They follow the `search_content` precedent instead.
--   2. They are scoped by (source_id, generation). A rebuilt store reuses
--      row IDs, so a generation boundary is what keeps a new store's rows
--      from being appended onto the old ones.
--   3. Their session FK still cascades, so deleting a session removes its
--      enrichment exactly as it removes its analytics.

-- One row per bound store file. `generation` changes when the source is
-- confirmed replaced; `revision` increments only when visible data changed,
-- so UI caches can key off it without re-rendering on every no-op refresh.
CREATE TABLE IF NOT EXISTS session_store_sources (
    source_id TEXT PRIMARY KEY,
    -- Resolved store path and the Copilot home that owns it. Sessions are
    -- eligible only when they came from that home's session-state directory.
    db_path TEXT NOT NULL,
    copilot_home TEXT NOT NULL,
    session_state_dir TEXT NOT NULL,
    generation TEXT NOT NULL,
    -- Hash over the probed table/column signature, and the source's own
    -- recorded version. The version is a diagnostic; the hash is the contract.
    capability_fingerprint TEXT,
    source_schema_version INTEGER,
    -- Comma-separated capability names this build found usable.
    capabilities TEXT,
    -- SourceAvailability: disabled | missing | ready | busy | unreadable |
    -- incompatible.
    availability TEXT NOT NULL,
    -- Short diagnostic for a non-ready availability. Never a path or payload.
    status_detail TEXT,
    last_attempt_at TEXT,
    last_success_at TEXT,
    revision INTEGER NOT NULL DEFAULT 0,
    enrichment_version INTEGER NOT NULL DEFAULT 0
);

-- One row per recorded model request.
--
-- Counters are nullable on purpose: NULL means the source recorded nothing,
-- while 0 means it recorded a zero. Nano-AIU totals and the request
-- multiplier are TEXT because they are exact decimals that exceed both
-- INTEGER-safe JS numbers and binary floating point.
CREATE TABLE IF NOT EXISTS session_request_usage (
    source_id TEXT NOT NULL,
    generation TEXT NOT NULL,
    -- assistant_usage_events.id. Row identity within one generation only;
    -- it is not a provider request ID.
    source_row_id INTEGER NOT NULL,
    session_id TEXT NOT NULL,
    -- The source's own interaction counter, NOT a TracePilot turn index.
    source_turn_index INTEGER,
    agent_id TEXT,
    parent_tool_call_id TEXT,
    model TEXT NOT NULL,
    input_tokens INTEGER,
    output_tokens INTEGER,
    cache_read_tokens INTEGER,
    cache_write_tokens INTEGER,
    reasoning_tokens INTEGER,
    total_nano_aiu TEXT,
    request_multiplier TEXT,
    duration_ms REAL,
    time_to_first_token_ms REAL,
    -- First observable output, including reasoning and tool-call output.
    -- Not time to the first user-visible answer.
    output_ttft_ms REAL,
    inter_token_latency_ms REAL,
    -- user | agent | sub-agent | compaction | an unrecognised value | NULL.
    -- NULL is a historical absence, not an implicit "user".
    initiator TEXT,
    api_endpoint TEXT,
    reasoning_effort TEXT,
    finish_reason TEXT,
    content_filter_triggered INTEGER,
    copilot_usage_model TEXT,
    -- complete | absent | partial | invalid
    billing_items_status TEXT NOT NULL,
    -- exact | differs | notComparable | incomputable
    billing_check TEXT,
    recorded_at TEXT,
    -- Comma-separated source column names whose cells were unusable.
    invalid_fields TEXT,
    row_fingerprint TEXT NOT NULL,
    PRIMARY KEY (source_id, generation, source_row_id),
    FOREIGN KEY (source_id) REFERENCES session_store_sources(source_id) ON DELETE CASCADE,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_request_usage_session_time
    ON session_request_usage(session_id, recorded_at, source_row_id);
CREATE INDEX IF NOT EXISTS idx_request_usage_session_agent
    ON session_request_usage(session_id, agent_id);
CREATE INDEX IF NOT EXISTS idx_request_usage_model_time
    ON session_request_usage(model, recorded_at);

-- Itemised billing, one row per entry of the source's token_details array.
-- The array is kept as an ordered list rather than a map keyed by category:
-- repeated categories at different rates are the historical rate evidence.
CREATE TABLE IF NOT EXISTS session_request_billing_items (
    source_id TEXT NOT NULL,
    generation TEXT NOT NULL,
    source_row_id INTEGER NOT NULL,
    ordinal INTEGER NOT NULL,
    session_id TEXT NOT NULL,
    token_type TEXT NOT NULL,
    token_count INTEGER,
    batch_size INTEGER,
    -- Exact decimal rate per batch, in nano AI units.
    cost_per_batch TEXT,
    -- Per-entry billing model, when the entry carries one. Falls back to the
    -- request's copilot_usage_model, never to the execution model.
    billing_model TEXT,
    PRIMARY KEY (source_id, generation, source_row_id, ordinal),
    FOREIGN KEY (source_id, generation, source_row_id)
        REFERENCES session_request_usage(source_id, generation, source_row_id) ON DELETE CASCADE,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_request_billing_session
    ON session_request_billing_items(session_id);

-- PR, issue and Git-ref mentions found in a session. A reference is evidence
-- that the session mentioned the work, never that it authored or merged it.
CREATE TABLE IF NOT EXISTS session_work_refs (
    source_id TEXT NOT NULL,
    generation TEXT NOT NULL,
    -- Composite identity, because the source's own row id is optional and its
    -- uniqueness key is already (session_id, ref_type, ref_value).
    ref_identity TEXT NOT NULL,
    session_id TEXT NOT NULL,
    source_row_id INTEGER,
    -- pullRequest | issue | gitRef | an unrecognised source ref_type.
    kind TEXT NOT NULL,
    raw_value TEXT NOT NULL,
    normalized_value TEXT NOT NULL,
    -- Host taken from the reference itself. Never derived from host_type,
    -- which is a kind of host, not a hostname.
    resolved_host TEXT,
    resolved_repository TEXT,
    -- The session's own repository, when it supplied the context above.
    candidate_repository TEXT,
    -- explicit | sessionContext | unresolved. Only `explicit` is navigable.
    resolution TEXT NOT NULL,
    -- 1 when a gitRef value is 7-40 hex characters. A candidate, not proof
    -- that the commit exists.
    sha_shaped INTEGER,
    source_turn_index INTEGER,
    recorded_at TEXT,
    PRIMARY KEY (source_id, generation, session_id, ref_identity),
    FOREIGN KEY (source_id) REFERENCES session_store_sources(source_id) ON DELETE CASCADE,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_work_refs_kind_value
    ON session_work_refs(kind, normalized_value);
CREATE INDEX IF NOT EXISTS idx_work_refs_scoped
    ON session_work_refs(resolved_host, resolved_repository, kind, normalized_value);
CREATE INDEX IF NOT EXISTS idx_work_refs_session
    ON session_work_refs(session_id);

-- What one refresh of one session actually saw. Kept separate from the
-- session row so completeness survives a baseline reindex, and so "no
-- request detail recorded" never reads as "no API calls made".
CREATE TABLE IF NOT EXISTS session_store_coverage (
    source_id TEXT NOT NULL,
    generation TEXT NOT NULL,
    session_id TEXT NOT NULL,
    availability TEXT NOT NULL,
    -- current | stale | refreshing
    freshness TEXT NOT NULL,
    request_rows INTEGER NOT NULL DEFAULT 0,
    request_rows_rejected INTEGER NOT NULL DEFAULT 0,
    work_ref_rows INTEGER NOT NULL DEFAULT 0,
    work_ref_rows_rejected INTEGER NOT NULL DEFAULT 0,
    billing_absent INTEGER NOT NULL DEFAULT 0,
    billing_partial INTEGER NOT NULL DEFAULT 0,
    billing_invalid INTEGER NOT NULL DEFAULT 0,
    -- JSON object of per-metric {valid, missing, invalid} tallies.
    field_coverage_json TEXT,
    -- Comma-separated allowlisted columns this source lacks.
    missing_columns TEXT,
    source_schema_version INTEGER,
    -- unverified | reconciled | scopeDifference | partial | mismatch
    reconciliation_status TEXT,
    -- The accounting scope and metric set the verdict used. A verdict
    -- without them is not a verdict a reader can act on.
    reconciliation_scope TEXT,
    reconciliation_metrics TEXT,
    reconciliation_differences TEXT,
    -- Fingerprint of the event snapshot the reconciliation compared against,
    -- so a later log rewrite invalidates the verdict.
    event_fingerprint TEXT,
    read_at TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0,
    enrichment_version INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (source_id, generation, session_id),
    FOREIGN KEY (source_id) REFERENCES session_store_sources(source_id) ON DELETE CASCADE,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_store_coverage_session
    ON session_store_coverage(session_id);

-- Rebuildable joins from a request to TracePilot's own run/turn structure.
-- Separate from the request row so a mapping can be recomputed — after a log
-- rewrite or a reconstructor change — without touching the source hints.
CREATE TABLE IF NOT EXISTS session_request_links (
    source_id TEXT NOT NULL,
    generation TEXT NOT NULL,
    source_row_id INTEGER NOT NULL,
    session_id TEXT NOT NULL,
    -- The agent run this request belongs to, when one was identified.
    run_key TEXT,
    -- Reconstructed turn and event indices, when a mapping was validated.
    turn_index INTEGER,
    event_index INTEGER,
    -- agentId | parentToolCallId | compactionEvent | rootOrder | none
    join_method TEXT NOT NULL,
    -- exact | validated | ambiguous | unavailable
    join_status TEXT NOT NULL,
    event_fingerprint TEXT,
    mapping_version INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (source_id, generation, source_row_id),
    FOREIGN KEY (source_id, generation, source_row_id)
        REFERENCES session_request_usage(source_id, generation, source_row_id) ON DELETE CASCADE,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_request_links_session_run
    ON session_request_links(session_id, run_key);

-- Event-derived claims expire with the indexed snapshot; request evidence
-- survives until the independent enrichment pass can safely refresh it.
CREATE TRIGGER invalidate_session_store_links
AFTER UPDATE OF events_mtime, events_size ON sessions
WHEN OLD.events_mtime IS NOT NEW.events_mtime OR OLD.events_size IS NOT NEW.events_size
BEGIN
    UPDATE session_request_links
       SET run_key = NULL, turn_index = NULL, event_index = NULL,
           join_status = 'unavailable', join_method = 'none', event_fingerprint = NULL
     WHERE session_id = NEW.id;
    UPDATE session_store_coverage
       SET freshness = 'stale', reconciliation_status = 'unverified',
           reconciliation_scope = '', reconciliation_metrics = '',
           reconciliation_differences = 'event log changed; refresh required', event_fingerprint = NULL
     WHERE session_id = NEW.id;
END;
