# Copilot CLI session store (`session-store.db`): can TracePilot use it?

Status: **Research** (2026-09-19). Read-only analysis of the author's local data plus the CLI
1.0.83 package. No CLI files were modified.

**Follow-up (2026-09-20):** See the [enrichment design](../features/copilot-session-store-enrichment-design.md)
for a fresh all-table inspection, complete request-field analysis, implementation phases and
fallbacks. It finds 416 sessions and 383 requests, explains the compaction accounting discrepancy,
and verifies itemized billing against every request. Counts below remain the original snapshot;
the updated integration guidance and current findings are in that design.

## 1. Short answer

- **Who has it?** Every Copilot CLI user since **1.0.40** (2026-05-01): "Session history, file
  tracking, and the /chronicle command are now available to all users". It started as
  experimental with `/chronicle` in 0.0.419 (2026-02-27). **It isn't gated by experimental
  mode.** The binary has feature flags only for adjacent features: the *cloud* session store
  (`CLOUD_SESSION_STORE` / `cloud_session_storage_enabled`) and Forge skill tracking. No setting
  to turn the local store off was found.
- **What is it?** A SQLite database at `<COPILOT_HOME>/session-store.db`. The CLI's native
  runtime (`prebuilds/<platform>/runtime.node`, "session store tracking") writes it **live**
  during turns and tool execution. The agent itself queries it (`sql` tool with
  `database: "session_store"`), and `/chronicle` search, standup, tips and cost-tips are built
  on it. `/chronicle reindex` rebuilds it from session history.
- **Is it complete?** On this machine it covers **all 388 on-disk sessions**, including all 343
  created before 1.0.40, so it has been backfilled. It also has **21 sessions that aren't on
  disk**: 18 with host type `github` and 3 with none, likely remote or cloud sessions.
- **Is it accurate?** Per-request usage rows **reconcile exactly** with `session.shutdown`
  request/input/output totals in 7 of 8 sessions originally checked. The eighth differs by
  1 request (112 vs 111). The follow-up identifies that request as compaction: its tokens
  are outside shutdown model totals, while its charge is already included in session credits.
- **Should TracePilot piggyback?** Yes, but only as an **optional, read-only enrichment**, and
  `events.jsonl` stays canonical. Its most valuable content is data that `events.jsonl` doesn't
  persist: per-request usage and latency, plus extracted PR, issue and commit refs.

## 2. Schema (1.0.83)

The initial inspection reported `schema_version = 1`; the fresh 2026-09-20 database inspection
returns **8**, and also finds `assistant_usage_events.copilot_usage_model`. Columns have been
added over time with `ALTER TABLE`. **Don't rely on the version number alone.** Record it for
diagnostics and detect capabilities with `pragma table_info`.

| Table | Rows (local) | Sessions covered | Contents | Does TracePilot have an equivalent? |
|---|---:|---:|---|---|
| `sessions` | 409 | n/a | id, cwd, repository, host_type, branch, summary, created/updated | Yes (index `sessions`) |
| `turns` | 1,725 | 386 | One row per user interaction: `user_message`, `assistant_response`, timestamp | Yes, and richer (turn reconstruction) |
| `checkpoints` | 697 | 181 | Compaction checkpoints split into `title`, `overview`, `history`, `work_done`, `technical_details`, `important_files`, `next_steps` | Partly: TracePilot parses checkpoint files, but not as structured sections |
| `session_files` | 5,835 | 228 | file_path, tool_name (`create`/`edit`), turn_index, first_seen | Mostly (`session_modified_files`) |
| `session_refs` | 541 | **45** | `ref_type` pr (389), issue (67), commit (85); `ref_value`; turn_index | **No** |
| `assistant_usage_events` | 368 | **15** | **One row per model request**: model, input/output/cache-read/cache-write/reasoning tokens, nano-AIU, multiplier, duration, **TTFT**, output TTFT, **inter-token latency**, initiator, api_endpoint, reasoning_effort, **finish_reason**, content_filter_triggered, `agent_id`, `parent_tool_call_id` | **No** (`events.jsonl` has only session totals; the per-request `assistant.usage` is ephemeral) |
| `search_index` (FTS5) | 6,033 docs | n/a | Source types: turn, checkpoint_* sections, workspace_artifact | Yes (TracePilot has its own FTS index) |
| `dynamic_context_items` | 0 | n/a | Repo and branch scoped retrieval items (dynamic retrieval feature) | n/a |
| `forge_trajectory_events`, `forge_skill_proposals` | 0 | n/a | Forge draft-skill mining (feature-flagged) | n/a |

The same runtime also contains per-session databases (`session.db`, with `todos` and
`todo_deps`) and factory tables. Those are separate files and out of scope here.

## 3. Coverage and quality checks

| Check | Result |
|---|---|
| Disk sessions present in store | 388 / 388 (<1.0.40: 343/343; 1.0.40–1.0.68: 27/27; ≥1.0.69: 18/18) |
| Sessions ≥1.0.69 with usage rows | 15 / 18 (2 of the 3 without rows made no model calls; the third was not investigated) |
| Usage rows vs shutdown `modelMetrics` (requests, input tokens, output tokens) | Exact match in 7/8 original sessions. Follow-up: the 112-vs-111 difference is a compaction request, verified against its persisted compaction event. |
| `initiator` | NULL on 164 rows (earlier 1.0.69–1.0.75 era). Otherwise user / agent / sub-agent / compaction. |
| `agent_id`, `parent_tool_call_id` | Set on all 150 `sub-agent` rows. Enables per-agent latency and usage. |
| Cache TTL sanity | Gap to the previous call under 5 min: 331/348 hits. Over 30 min: 0/1 hits. First call of a session: 0/16. |
| `session_refs.ref_value` | Bare numbers for PRs and issues (no repo). Resolve with `sessions.repository`. Commit values can be branch names (e.g. `main`), so they need validation. |

## 4. Opportunities, ranked

| Rank | Use | Value | Depends on store? |
|---|---|---|---|
| 1 | **Observed cache outcomes** for prompt-cache insights (upgrade Predicted to Observed) | High. It's the only offline source of per-request cache reads. | Optional enrichment ([plan §8](../features/prompt-cache-insights-plan.md)) |
| 2 | **Per-request latency and throughput** (TTFT, ITL, tokens/s) by model, initiator and agent | High for Model Comparison and the Agents Usage tab | Yes (no events.jsonl equivalent) |
| 3 | **Linked work**: PR, issue and commit refs per session, plus a `pr:` search qualifier | High, cheap | Yes (TracePilot could extract refs itself, but the CLI already does it) |
| 4 | **Structured checkpoint sections** for a compaction ledger diff | Medium | No. TracePilot can parse `summaryContent` tags itself, which is preferred. |
| 5 | **Store-only sessions** (21 not on disk) listed as "known remotely" | Low–medium | Yes |
| 6 | `finish_reason` / `content_filter_triggered` per request | Low (0 filtered locally) | Yes |
| 7 | FTS, files, turns | None. TracePilot already has better equivalents. | n/a |

## 5. Guardrails for any integration

1. **Read-only, always.** The CLI writes this file live (WAL mode) and the agent itself runs SQL
   against it. Open it with `SQLITE_OPEN_READONLY`, a busy timeout and no `immutable` flag,
   because it changes. Use a short read transaction for a consistent batch, or SQLite's
   [backup API](https://www.sqlite.org/backup.html) for a consistent snapshot. Independently
   copying live `db`, `-wal` and `-shm` files is not an atomic snapshot. Never run `VACUUM`
   or checkpoint the source, and never attach it for writing.
2. **Capability detection, not versioning.** Probe `sqlite_master` and
   `pragma table_info(<table>)`. Each feature declares the columns it needs and disables itself
   quietly if they're missing.
3. **Resolve the configured source.** Use TracePilot's configured Copilot home, whose defaults
   honor `COPILOT_HOME` and data-root isolation through `tracepilot_core::paths::CopilotPaths`.
   Do not infer source ownership for arbitrary custom session directories or imported sessions.
4. **Never the only source.** Every UI that uses it has an `events.jsonl` baseline, and labels
   store-derived values ("from Copilot session store").
5. **Privacy.** It holds the same content as session files: full user messages and responses.
   Do not duplicate transcripts in the enrichment index. Store only allowlisted request
   counters, timings, billing items, references and provenance needed by shipped features.
   New fields need explicit export/redaction support; existing rules do not cover them automatically.
6. **Schema watch.** Extend the version analyzer to extract `CREATE TABLE` and `ALTER TABLE`
   strings from `runtime.node` for each CLI version (found via `strings`; the schema isn't in
   `app.js`), and diff them like event schemas.
7. **Performance and correctness.** The original DB was about 51 MB for 409 sessions. Use
   indexed, bounded per-session reads. An `id > last_seen_id` cursor alone misses updates,
   deletions and rebuilt stores with reused IDs; the follow-up starts with complete per-session
   refreshes and explicit source generations.

## 6. Proposed adapter

This original sketch is superseded by the [integration architecture and contracts](../features/copilot-session-store-enrichment-design.md#7-integration-architecture).
In particular, the new adapter distinguishes absence from errors, and refresh runs independently
of JSONL staleness rather than only during baseline session indexing.

`crates/tracepilot-core/src/chronicle/` (read-only):

```rust
pub struct ChronicleStore { path: PathBuf, caps: ChronicleCaps }
pub struct ChronicleCaps { usage_events: bool, usage_output_ttft: bool, refs: bool, checkpoints: bool }
impl ChronicleStore {
    pub fn open_readonly(copilot_home: &Path) -> Option<Self>;          // None if absent
    pub fn usage_for_session(&self, id: &str) -> Result<Vec<RequestUsage>>;
    pub fn refs_for_session(&self, id: &str) -> Result<Vec<SessionRef>>;
    pub fn sessions_with_ref(&self, kind: RefKind, value: &str) -> Result<Vec<String>>;
}
```

The UI never opens the CLI store directly. A Settings toggle, "Use Copilot session store for
enrichment", defaults to on. Missing data changes runtime availability, not the saved preference,
so a later-created store can be discovered automatically. The follow-up specifies separate
enrichment tables, refresh lifecycle, retention and fallback behavior.

## 7. How this was established

- Changelog entries: 0.0.419 (`/chronicle` experimental), 1.0.40 (all users), 1.0.49 and 1.0.51
  (`/chronicle` search and cost-tips), 1.0.69 (exact local usage in Chronicle and session SQL),
  1.0.71 (cost profiles), 1.0.85 (session and memory import for a semantic JSONL format).
- Schema and behaviour strings come from `strings runtime.node` in CLI 1.0.83: the DDL, the
  upsert statements, "session store tracking", the `session_store_sql` tool text and the cloud
  feature flag.
- Coverage and reconciliation used a temporary copy of the DB plus WAL, compared against
  `~/.copilot/session-state/*/events.jsonl`.
