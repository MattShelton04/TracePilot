# Complete schema inventory

Snapshot definitions below come from `sqlite_schema`, `table_list`, `table_xinfo`, `index_list`, `index_xinfo` and `foreign_key_list`. The coverage manifest compares them with all current migration SQL and the search-column pre/post hooks. Declared NOT NULL is separate from primary-key behavior: a rowid-table TEXT primary key can admit NULL; INTEGER PRIMARY KEY aliases the engine rowid. No inferred NOT NULL flag is substituted.

Column meanings/dispositions: [catalogue](catalogue.md), [analytics](analytics.md), [search](search.md). Measurements: [statistics](statistics.md). Complete searchable semantic records live in the linked `semantics-*.json` files.

## `maintenance_state`

Kind: **table**; WITHOUT ROWID: False; STRICT: False. Disposition: **KEEP** — Small key/value throttle cache for database maintenance; independent from migration and extraction versions. Measured snapshot: 1 rows; see [statistics](statistics.md#maintenance_state) and [physical storage](storage.md). Table B-tree alone allocates 4,096 bytes (0 included overflow bytes); this excludes separate indexes and is not per-column savings.

| Column | Declared type | NOT NULL | Default | PK ordinal | Hidden/generated code | Disposition |
| --- | --- | --- | --- | --- | --- | --- |
| `key` | TEXT | False | none | 1 | 0 | CHANGE |
| `value` | TEXT | False | none | 0 | 0 | CHANGE |

Hidden code: 0 ordinary; 1 virtual hidden; 2 virtual generated; 3 stored generated.

Implicit `rowid` / `_rowid_` / `oid`: **KEEP**, engine integer identity; separate from declared primary key. Used by SQLite B-trees; FTS content row identities are additionally part of synchronization. No extra allocated column is claimed.

### Keys, relationships and DDL

- `sqlite_autoindex_maintenance_state_1`: unique=True, origin=pk, partial=False; index_xinfo `[[0, 0, "key", 0, "BINARY", 1], [1, -1, null, 0, "BINARY", 0]]`.

Index tuples are `(sequence, cid, name, descending, collation, key)`; cid -1 denotes rowid, -2 an expression. Origin `pk`/`u` identifies constraint-owned autoindexes.

`table maintenance_state`:

```sql
CREATE TABLE maintenance_state (
    key   TEXT PRIMARY KEY,
    value TEXT
)
```

## `schema_version`

Kind: **table**; WITHOUT ROWID: False; STRICT: False. Disposition: **KEEP** — Append-only applied migration ledger, not a singleton version cell or PRAGMA user_version. MAX(version) is authoritative; missing v12 is an intentional plan gap. Measured snapshot: 24 rows; see [statistics](statistics.md#schema_version) and [physical storage](storage.md). Table B-tree alone allocates 4,096 bytes (0 included overflow bytes); this excludes separate indexes and is not per-column savings.

| Column | Declared type | NOT NULL | Default | PK ordinal | Hidden/generated code | Disposition |
| --- | --- | --- | --- | --- | --- | --- |
| `version` | INTEGER | True | none | 0 | 0 | KEEP |
| `applied_at` | TEXT | False | datetime('now') | 0 | 0 | KEEP |

Hidden code: 0 ordinary; 1 virtual hidden; 2 virtual generated; 3 stored generated.

Implicit `rowid` / `_rowid_` / `oid`: **KEEP**, engine integer identity; separate from declared primary key. Used by SQLite B-trees; FTS content row identities are additionally part of synchronization. No extra allocated column is claimed.

### Keys, relationships and DDL

No separately listed index or foreign key.

Index tuples are `(sequence, cid, name, descending, collation, key)`; cid -1 denotes rowid, -2 an expression. Origin `pk`/`u` identifies constraint-owned autoindexes.

`table schema_version`:

```sql
CREATE TABLE schema_version (
            version    INTEGER NOT NULL,
            applied_at TEXT DEFAULT (datetime('now'))
         )
```

## `search_content`

Kind: **table**; WITHOUT ROWID: False; STRICT: False. Disposition: **KEEP** — Current deep-search content source, browse/facets, context navigation and tool/skill discovery; rebuildable from successful provider snapshots, but retained last-good rows preserve failed/cancelled refreshes. Frozen snapshot evidence: 679,345 rows, 336,801,792 physical b-tree bytes. Occupancy does not replace the source/engine-use rationale.

| Column | Declared type | NOT NULL | Default | PK ordinal | Hidden/generated code | Disposition |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | INTEGER | False | none | 1 | 0 | KEEP |
| `session_id` | TEXT | True | none | 0 | 0 | KEEP |
| `content_type` | TEXT | True | none | 0 | 0 | KEEP |
| `turn_number` | INTEGER | False | none | 0 | 0 | KEEP |
| `event_index` | INTEGER | False | none | 0 | 0 | KEEP |
| `timestamp_unix` | INTEGER | False | none | 0 | 0 | KEEP |
| `tool_name` | TEXT | False | none | 0 | 0 | KEEP |
| `content` | TEXT | True | none | 0 | 0 | KEEP |
| `metadata_json` | TEXT | False | none | 0 | 0 | KEEP |

Hidden code: 0 ordinary; 1 virtual hidden; 2 virtual generated; 3 stored generated.

Implicit `rowid` / `_rowid_` / `oid`: **KEEP**, alias of `id` (same value/storage). Used by SQLite B-trees; FTS content row identities are additionally part of synchronization. No extra allocated column is claimed.

### Keys, relationships and DDL

- `idx_search_content_session_event`: unique=False, origin=c, partial=False; index_xinfo `[[0, 1, "session_id", 0, "BINARY", 1], [1, 4, "event_index", 0, "BINARY", 1], [2, -1, null, 0, "BINARY", 0]]`.
- `idx_search_content_session_ts_type`: unique=False, origin=c, partial=False; index_xinfo `[[0, 1, "session_id", 0, "BINARY", 1], [1, 5, "timestamp_unix", 0, "BINARY", 1], [2, 2, "content_type", 0, "BINARY", 1], [3, -1, null, 0, "BINARY", 0]]`.
- `idx_search_content_type_ts`: unique=False, origin=c, partial=False; index_xinfo `[[0, 2, "content_type", 0, "BINARY", 1], [1, 5, "timestamp_unix", 0, "BINARY", 1], [2, -1, null, 0, "BINARY", 0]]`.
- `idx_search_content_tool`: unique=False, origin=c, partial=False; index_xinfo `[[0, 6, "tool_name", 0, "BINARY", 1], [1, -1, null, 0, "BINARY", 0]]`.
- `idx_search_content_timestamp`: unique=False, origin=c, partial=False; index_xinfo `[[0, 5, "timestamp_unix", 0, "BINARY", 1], [1, -1, null, 0, "BINARY", 0]]`.
- Foreign key `[0, 0, "sessions", "session_id", "id", "NO ACTION", "CASCADE", "NONE"]` (id, seq, target table, from, to, update, delete, match).

Index tuples are `(sequence, cid, name, descending, collation, key)`; cid -1 denotes rowid, -2 an expression. Origin `pk`/`u` identifies constraint-owned autoindexes.

`index idx_search_content_session_event`:

```sql
CREATE INDEX idx_search_content_session_event ON search_content(session_id, event_index)
```

`index idx_search_content_session_ts_type`:

```sql
CREATE INDEX idx_search_content_session_ts_type ON search_content(session_id, timestamp_unix, content_type)
```

`index idx_search_content_timestamp`:

```sql
CREATE INDEX idx_search_content_timestamp ON search_content(timestamp_unix)
```

`index idx_search_content_tool`:

```sql
CREATE INDEX idx_search_content_tool ON search_content(tool_name)
```

`index idx_search_content_type_ts`:

```sql
CREATE INDEX idx_search_content_type_ts ON search_content(content_type, timestamp_unix)
```

`table search_content`:

```sql
CREATE TABLE search_content (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    content_type TEXT NOT NULL CHECK(content_type IN (
        'user_message', 'assistant_message', 'reasoning',
        'tool_call', 'tool_result', 'tool_error', 'error',
        'compaction_summary', 'system_message', 'subagent', 'checkpoint'
    )),
    turn_number INTEGER,
    event_index INTEGER,
    timestamp_unix INTEGER,
    tool_name TEXT,
    content TEXT NOT NULL CHECK(length(trim(content)) > 0),
    metadata_json TEXT,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
)
```

`trigger search_content_ad`:

```sql
CREATE TRIGGER search_content_ad AFTER DELETE ON search_content BEGIN
    INSERT INTO search_fts(search_fts, rowid, content) VALUES ('delete', old.id, old.content);
END
```

`trigger search_content_ai`:

```sql
CREATE TRIGGER search_content_ai AFTER INSERT ON search_content BEGIN
        INSERT INTO search_fts(rowid, content) VALUES (new.id, new.content);
     END
```

`trigger search_content_au`:

```sql
CREATE TRIGGER search_content_au AFTER UPDATE ON search_content BEGIN
    INSERT INTO search_fts(search_fts, rowid, content) VALUES ('delete', old.id, old.content);
    INSERT INTO search_fts(rowid, content) VALUES (new.id, new.content);
END
```

## `search_fts`

Kind: **virtual**; WITHOUT ROWID: False; STRICT: False. Disposition: **KEEP** — FTS5 external-content index over search_content; generated terms and engine state are maintained by triggers/rebuild paths. Not duplicate removable application storage. Frozen snapshot evidence: 679,345 rows; virtual external-content rows have no independently attributed table b-tree. Occupancy does not replace the source/engine-use rationale.

| Column | Declared type | NOT NULL | Default | PK ordinal | Hidden/generated code | Disposition |
| --- | --- | --- | --- | --- | --- | --- |
| `content` | (none) | False | none | 0 | 0 | KEEP |
| `search_fts` | (none) | False | none | 0 | 1 | KEEP |
| `rank` | (none) | False | none | 0 | 1 | KEEP |

Hidden code: 0 ordinary; 1 virtual hidden; 2 virtual generated; 3 stored generated.

Implicit `rowid` / `_rowid_` / `oid`: **KEEP**, engine integer identity; separate from declared primary key. Used by SQLite B-trees; FTS content row identities are additionally part of synchronization. No extra allocated column is claimed.

### Keys, relationships and DDL

No separately listed index or foreign key.

Index tuples are `(sequence, cid, name, descending, collation, key)`; cid -1 denotes rowid, -2 an expression. Origin `pk`/`u` identifies constraint-owned autoindexes.

`table search_fts`:

```sql
CREATE VIRTUAL TABLE search_fts USING fts5(
    content,
    content='search_content',
    content_rowid='id',
    tokenize='unicode61'
)
```

## `search_fts_config`

Kind: **shadow**; WITHOUT ROWID: True; STRICT: False. Disposition: **KEEP** — SQLite FTS5 config shadow storage for search_fts; ownership and hidden use follow virtual table definition, not direct application references. Frozen snapshot evidence: 2 rows, 4,096 physical b-tree bytes. Occupancy does not replace the source/engine-use rationale.

| Column | Declared type | NOT NULL | Default | PK ordinal | Hidden/generated code | Disposition |
| --- | --- | --- | --- | --- | --- | --- |
| `k` | (none) | True | none | 1 | 0 | KEEP |
| `v` | (none) | False | none | 0 | 0 | KEEP |

Hidden code: 0 ordinary; 1 virtual hidden; 2 virtual generated; 3 stored generated.

No implicit rowid (WITHOUT ROWID).

### Keys, relationships and DDL

- `sqlite_autoindex_search_fts_config_1`: unique=True, origin=pk, partial=False; index_xinfo `[[0, 0, "k", 0, "BINARY", 1], [1, 1, "v", 0, "BINARY", 0]]`.

Index tuples are `(sequence, cid, name, descending, collation, key)`; cid -1 denotes rowid, -2 an expression. Origin `pk`/`u` identifies constraint-owned autoindexes.

`table search_fts_config`:

```sql
CREATE TABLE 'search_fts_config'(k PRIMARY KEY, v) WITHOUT ROWID
```

## `search_fts_data`

Kind: **shadow**; WITHOUT ROWID: False; STRICT: False. Disposition: **KEEP** — SQLite FTS5 data shadow storage for search_fts; ownership and hidden use follow virtual table definition, not direct application references. Frozen snapshot evidence: 21,946 rows, 87,355,392 physical b-tree bytes. Occupancy does not replace the source/engine-use rationale.

| Column | Declared type | NOT NULL | Default | PK ordinal | Hidden/generated code | Disposition |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | INTEGER | False | none | 1 | 0 | KEEP |
| `block` | BLOB | False | none | 0 | 0 | KEEP |

Hidden code: 0 ordinary; 1 virtual hidden; 2 virtual generated; 3 stored generated.

Implicit `rowid` / `_rowid_` / `oid`: **KEEP**, alias of `id` (same value/storage). Used by SQLite B-trees; FTS content row identities are additionally part of synchronization. No extra allocated column is claimed.

### Keys, relationships and DDL

No separately listed index or foreign key.

Index tuples are `(sequence, cid, name, descending, collation, key)`; cid -1 denotes rowid, -2 an expression. Origin `pk`/`u` identifies constraint-owned autoindexes.

`table search_fts_data`:

```sql
CREATE TABLE 'search_fts_data'(id INTEGER PRIMARY KEY, block BLOB)
```

## `search_fts_docsize`

Kind: **shadow**; WITHOUT ROWID: False; STRICT: False. Disposition: **KEEP** — SQLite FTS5 docsize shadow storage for search_fts; ownership and hidden use follow virtual table definition, not direct application references. Frozen snapshot evidence: 679,345 rows, 6,864,896 physical b-tree bytes. Occupancy does not replace the source/engine-use rationale.

| Column | Declared type | NOT NULL | Default | PK ordinal | Hidden/generated code | Disposition |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | INTEGER | False | none | 1 | 0 | KEEP |
| `sz` | BLOB | False | none | 0 | 0 | KEEP |

Hidden code: 0 ordinary; 1 virtual hidden; 2 virtual generated; 3 stored generated.

Implicit `rowid` / `_rowid_` / `oid`: **KEEP**, alias of `id` (same value/storage). Used by SQLite B-trees; FTS content row identities are additionally part of synchronization. No extra allocated column is claimed.

### Keys, relationships and DDL

No separately listed index or foreign key.

Index tuples are `(sequence, cid, name, descending, collation, key)`; cid -1 denotes rowid, -2 an expression. Origin `pk`/`u` identifies constraint-owned autoindexes.

`table search_fts_docsize`:

```sql
CREATE TABLE 'search_fts_docsize'(id INTEGER PRIMARY KEY, sz BLOB)
```

## `search_fts_idx`

Kind: **shadow**; WITHOUT ROWID: True; STRICT: False. Disposition: **KEEP** — SQLite FTS5 idx shadow storage for search_fts; ownership and hidden use follow virtual table definition, not direct application references. Frozen snapshot evidence: 7,767 rows, 172,032 physical b-tree bytes. Occupancy does not replace the source/engine-use rationale.

| Column | Declared type | NOT NULL | Default | PK ordinal | Hidden/generated code | Disposition |
| --- | --- | --- | --- | --- | --- | --- |
| `segid` | (none) | True | none | 1 | 0 | KEEP |
| `term` | (none) | True | none | 2 | 0 | KEEP |
| `pgno` | (none) | False | none | 0 | 0 | KEEP |

Hidden code: 0 ordinary; 1 virtual hidden; 2 virtual generated; 3 stored generated.

No implicit rowid (WITHOUT ROWID).

### Keys, relationships and DDL

- `sqlite_autoindex_search_fts_idx_1`: unique=True, origin=pk, partial=False; index_xinfo `[[0, 0, "segid", 0, "BINARY", 1], [1, 1, "term", 0, "BINARY", 1], [2, 2, "pgno", 0, "BINARY", 0]]`.

Index tuples are `(sequence, cid, name, descending, collation, key)`; cid -1 denotes rowid, -2 an expression. Origin `pk`/`u` identifies constraint-owned autoindexes.

`table search_fts_idx`:

```sql
CREATE TABLE 'search_fts_idx'(segid, term, pgno, PRIMARY KEY(segid, term)) WITHOUT ROWID
```

## `session_activity`

Kind: **table**; WITHOUT ROWID: False; STRICT: False. Disposition: **KEEP** — Sparse per-session weekday/hour tool invocation buckets feed Tool Analysis 7x24 heatmap; reconstructable cache whose date scope filters sessions, not individual historical calls. Measured snapshot: 1,254 rows; see [statistics](statistics.md#session_activity) and [physical storage](storage.md). Table B-tree alone allocates 73,728 bytes (0 included overflow bytes); this excludes separate indexes and is not per-column savings.

| Column | Declared type | NOT NULL | Default | PK ordinal | Hidden/generated code | Disposition |
| --- | --- | --- | --- | --- | --- | --- |
| `session_id` | TEXT | True | none | 1 | 0 | KEEP |
| `day_of_week` | INTEGER | True | none | 2 | 0 | KEEP |
| `hour` | INTEGER | True | none | 3 | 0 | KEEP |
| `tool_call_count` | INTEGER | False | 0 | 0 | 0 | KEEP |

Hidden code: 0 ordinary; 1 virtual hidden; 2 virtual generated; 3 stored generated.

Implicit `rowid` / `_rowid_` / `oid`: **KEEP**, engine integer identity; separate from declared primary key. Used by SQLite B-trees; FTS content row identities are additionally part of synchronization. No extra allocated column is claimed.

### Keys, relationships and DDL

- `sqlite_autoindex_session_activity_1`: unique=True, origin=pk, partial=False; index_xinfo `[[0, 0, "session_id", 0, "BINARY", 1], [1, 1, "day_of_week", 0, "BINARY", 1], [2, 2, "hour", 0, "BINARY", 1], [3, -1, null, 0, "BINARY", 0]]`.
- Foreign key `[0, 0, "sessions", "session_id", "id", "NO ACTION", "CASCADE", "NONE"]` (id, seq, target table, from, to, update, delete, match).

Index tuples are `(sequence, cid, name, descending, collation, key)`; cid -1 denotes rowid, -2 an expression. Origin `pk`/`u` identifies constraint-owned autoindexes.

`table session_activity`:

```sql
CREATE TABLE session_activity (
    session_id TEXT NOT NULL,
    day_of_week INTEGER NOT NULL,
    hour INTEGER NOT NULL,
    tool_call_count INTEGER DEFAULT 0,
    PRIMARY KEY (session_id, day_of_week, hour),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
)
```

## `session_agent_runs`

Kind: **table**; WITHOUT ROWID: False; STRICT: False. Disposition: **KEEP** — Active materialized analytics read model; source events/provider snapshots remain authoritative. Retain the table while reviewing individual persistence-only fields. Frozen snapshot: 5,825 exact rows. The measured population supports retaining this active read model; occupancy alone does not prove every column needs persistence.

| Column | Declared type | NOT NULL | Default | PK ordinal | Hidden/generated code | Disposition |
| --- | --- | --- | --- | --- | --- | --- |
| `session_id` | TEXT | True | none | 1 | 0 | KEEP |
| `run_key` | TEXT | True | none | 2 | 0 | KEEP |
| `tool_call_id` | TEXT | False | none | 0 | 0 | KEEP |
| `agent_id` | TEXT | False | none | 0 | 0 | DEPRECATE_REMOVE_CANDIDATE |
| `parent_run_key` | TEXT | False | none | 0 | 0 | DEPRECATE_REMOVE_CANDIDATE |
| `parent_agent_name` | TEXT | False | none | 0 | 0 | KEEP |
| `depth` | INTEGER | True | none | 0 | 0 | KEEP |
| `agent_name` | TEXT | True | none | 0 | 0 | KEEP |
| `agent_type` | TEXT | False | none | 0 | 0 | KEEP |
| `display_name` | TEXT | False | none | 0 | 0 | KEEP |
| `description` | TEXT | False | none | 0 | 0 | KEEP |
| `execution_mode` | TEXT | False | none | 0 | 0 | KEEP |
| `started_at` | TEXT | False | none | 0 | 0 | KEEP |
| `ended_at` | TEXT | False | none | 0 | 0 | DEPRECATE_REMOVE_CANDIDATE |
| `outcome` | TEXT | True | none | 0 | 0 | KEEP |
| `error_text` | TEXT | False | none | 0 | 0 | KEEP |
| `requested_model` | TEXT | False | none | 0 | 0 | DEPRECATE_REMOVE_CANDIDATE |
| `model` | TEXT | False | none | 0 | 0 | KEEP |
| `configured_model` | TEXT | False | none | 0 | 0 | KEEP |
| `configured_effort` | TEXT | False | none | 0 | 0 | DEPRECATE_REMOVE_CANDIDATE |
| `context_tier` | TEXT | False | none | 0 | 0 | DEPRECATE_REMOVE_CANDIDATE |
| `multi_turn` | INTEGER | False | none | 0 | 0 | KEEP |
| `first_dispatched_model` | TEXT | False | none | 0 | 0 | KEEP |
| `explicit_model_override` | TEXT | False | none | 0 | 0 | DEPRECATE_REMOVE_CANDIDATE |
| `model_override_reason` | TEXT | False | none | 0 | 0 | KEEP |
| `configured_model_preference` | TEXT | False | none | 0 | 0 | DEPRECATE_REMOVE_CANDIDATE |
| `configured_matches_actual` | INTEGER | False | none | 0 | 0 | KEEP |
| `total_tool_calls` | INTEGER | False | none | 0 | 0 | KEEP |
| `total_tokens` | INTEGER | False | none | 0 | 0 | KEEP |
| `duration_ms` | INTEGER | False | none | 0 | 0 | KEEP |
| `own_nano_aiu` | INTEGER | False | none | 0 | 0 | KEEP |
| `follow_up_count` | INTEGER | True | 0 | 0 | 0 | KEEP |
| `peak_siblings` | INTEGER | True | 1 | 0 | 0 | KEEP |
| `turn_index` | INTEGER | True | none | 0 | 0 | KEEP |
| `event_index` | INTEGER | False | none | 0 | 0 | KEEP |
| `source` | TEXT | True | none | 0 | 0 | DEPRECATE_REMOVE_CANDIDATE |
| `messages_sent` | INTEGER | True | 0 | 0 | 0 | KEEP |
| `messages_received` | INTEGER | True | 0 | 0 | 0 | KEEP |
| `peer_messages` | INTEGER | True | 0 | 0 | 0 | KEEP |
| `queued_messages` | INTEGER | True | 0 | 0 | 0 | KEEP |

Hidden code: 0 ordinary; 1 virtual hidden; 2 virtual generated; 3 stored generated.

Implicit `rowid` / `_rowid_` / `oid`: **KEEP**, engine integer identity; separate from declared primary key. Used by SQLite B-trees; FTS content row identities are additionally part of synchronization. No extra allocated column is claimed.

### Keys, relationships and DDL

- `idx_agent_runs_started`: unique=False, origin=c, partial=False; index_xinfo `[[0, 12, "started_at", 0, "BINARY", 1], [1, -1, null, 0, "BINARY", 0]]`.
- `idx_agent_runs_name_started`: unique=False, origin=c, partial=False; index_xinfo `[[0, 7, "agent_name", 0, "NOCASE", 1], [1, 12, "started_at", 0, "BINARY", 1], [2, -1, null, 0, "BINARY", 0]]`.
- `sqlite_autoindex_session_agent_runs_1`: unique=True, origin=pk, partial=False; index_xinfo `[[0, 0, "session_id", 0, "BINARY", 1], [1, 1, "run_key", 0, "BINARY", 1], [2, -1, null, 0, "BINARY", 0]]`.
- Foreign key `[0, 0, "sessions", "session_id", "id", "NO ACTION", "CASCADE", "NONE"]` (id, seq, target table, from, to, update, delete, match).

Index tuples are `(sequence, cid, name, descending, collation, key)`; cid -1 denotes rowid, -2 an expression. Origin `pk`/`u` identifies constraint-owned autoindexes.

`index idx_agent_runs_name_started`:

```sql
CREATE INDEX idx_agent_runs_name_started
    ON session_agent_runs(agent_name COLLATE NOCASE, started_at)
```

`index idx_agent_runs_started`:

```sql
CREATE INDEX idx_agent_runs_started
    ON session_agent_runs(started_at)
```

`table session_agent_runs`:

```sql
CREATE TABLE session_agent_runs (
    session_id TEXT NOT NULL,
    -- Launching tool-call ID, or the runtime agent ID when none was recorded.
    run_key TEXT NOT NULL,
    tool_call_id TEXT,
    agent_id TEXT,
    parent_run_key TEXT,
    -- NULL when launched by the main agent.
    parent_agent_name TEXT,
    depth INTEGER NOT NULL,
    agent_name TEXT NOT NULL,
    agent_type TEXT,
    display_name TEXT,
    description TEXT,
    -- "sync" | "background" (1.0.83+).
    execution_mode TEXT,
    started_at TEXT,
    ended_at TEXT,
    -- completed | failed | cancelled | incomplete
    outcome TEXT NOT NULL,
    error_text TEXT,
    requested_model TEXT,
    model TEXT,
    configured_model TEXT,
    configured_effort TEXT,
    context_tier TEXT,
    multi_turn INTEGER,
    first_dispatched_model TEXT,
    explicit_model_override TEXT,
    model_override_reason TEXT,
    configured_model_preference TEXT,
    configured_matches_actual INTEGER,
    total_tool_calls INTEGER,
    -- As reported by the CLI; can include descendants. Never sum across a hierarchy.
    total_tokens INTEGER,
    duration_ms INTEGER,
    -- Exclusive credits from the shutdown agentMetrics ledger (1.0.83+).
    own_nano_aiu INTEGER,
    follow_up_count INTEGER NOT NULL DEFAULT 0,
    peak_siblings INTEGER NOT NULL DEFAULT 1,
    turn_index INTEGER NOT NULL,
    event_index INTEGER,
    -- "events" (subagent lifecycle) | "task_args" (task call only).
    source TEXT NOT NULL, messages_sent INTEGER NOT NULL DEFAULT 0, messages_received INTEGER NOT NULL DEFAULT 0, peer_messages INTEGER NOT NULL DEFAULT 0, queued_messages INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (session_id, run_key),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
)
```

## `session_agent_selections`

Kind: **table**; WITHOUT ROWID: False; STRICT: False. Disposition: **KEEP** — Active materialized analytics read model; source events/provider snapshots remain authoritative. Retain the table while reviewing individual persistence-only fields. Frozen snapshot: 0 exact rows. This optional selection feature has no rows in this installation; zero population does not invalidate its established reader/schema contract.

| Column | Declared type | NOT NULL | Default | PK ordinal | Hidden/generated code | Disposition |
| --- | --- | --- | --- | --- | --- | --- |
| `session_id` | TEXT | True | none | 1 | 0 | KEEP |
| `event_index` | INTEGER | True | none | 2 | 0 | KEEP |
| `agent_name` | TEXT | False | none | 0 | 0 | KEEP |
| `display_name` | TEXT | False | none | 0 | 0 | KEEP |
| `selected` | INTEGER | True | none | 0 | 0 | KEEP |
| `timestamp` | TEXT | False | none | 0 | 0 | KEEP |

Hidden code: 0 ordinary; 1 virtual hidden; 2 virtual generated; 3 stored generated.

Implicit `rowid` / `_rowid_` / `oid`: **KEEP**, engine integer identity; separate from declared primary key. Used by SQLite B-trees; FTS content row identities are additionally part of synchronization. No extra allocated column is claimed.

### Keys, relationships and DDL

- `sqlite_autoindex_session_agent_selections_1`: unique=True, origin=pk, partial=False; index_xinfo `[[0, 0, "session_id", 0, "BINARY", 1], [1, 1, "event_index", 0, "BINARY", 1], [2, -1, null, 0, "BINARY", 0]]`.
- Foreign key `[0, 0, "sessions", "session_id", "id", "NO ACTION", "CASCADE", "NONE"]` (id, seq, target table, from, to, update, delete, match).

Index tuples are `(sequence, cid, name, descending, collation, key)`; cid -1 denotes rowid, -2 an expression. Origin `pk`/`u` identifies constraint-owned autoindexes.

`table session_agent_selections`:

```sql
CREATE TABLE session_agent_selections (
    session_id TEXT NOT NULL,
    event_index INTEGER NOT NULL,
    -- NULL for a deselection.
    agent_name TEXT,
    display_name TEXT,
    selected INTEGER NOT NULL,
    timestamp TEXT,
    PRIMARY KEY (session_id, event_index),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
)
```

## `session_cache_ttls`

Kind: **table**; WITHOUT ROWID: False; STRICT: False. Disposition: **KEEP** — Active materialized analytics read model; source events/provider snapshots remain authoritative. Retain the table while reviewing individual persistence-only fields. Frozen snapshot: 30 exact rows. The measured population supports retaining this active read model; occupancy alone does not prove every column needs persistence.

| Column | Declared type | NOT NULL | Default | PK ordinal | Hidden/generated code | Disposition |
| --- | --- | --- | --- | --- | --- | --- |
| `session_id` | TEXT | True | none | 1 | 0 | KEEP |
| `model` | TEXT | True | none | 2 | 0 | KEEP |
| `ttl_seconds` | INTEGER | True | none | 3 | 0 | KEEP |
| `observation_count` | INTEGER | True | none | 0 | 0 | KEEP |

Hidden code: 0 ordinary; 1 virtual hidden; 2 virtual generated; 3 stored generated.

Implicit `rowid` / `_rowid_` / `oid`: **KEEP**, engine integer identity; separate from declared primary key. Used by SQLite B-trees; FTS content row identities are additionally part of synchronization. No extra allocated column is claimed.

### Keys, relationships and DDL

- `sqlite_autoindex_session_cache_ttls_1`: unique=True, origin=pk, partial=False; index_xinfo `[[0, 0, "session_id", 0, "BINARY", 1], [1, 1, "model", 0, "BINARY", 1], [2, 2, "ttl_seconds", 0, "BINARY", 1], [3, -1, null, 0, "BINARY", 0]]`.
- Foreign key `[0, 0, "sessions", "session_id", "id", "NO ACTION", "CASCADE", "NONE"]` (id, seq, target table, from, to, update, delete, match).

Index tuples are `(sequence, cid, name, descending, collation, key)`; cid -1 denotes rowid, -2 an expression. Origin `pk`/`u` identifies constraint-owned autoindexes.

`table session_cache_ttls`:

```sql
CREATE TABLE session_cache_ttls (
    session_id TEXT NOT NULL,
    model TEXT NOT NULL,
    ttl_seconds INTEGER NOT NULL,
    observation_count INTEGER NOT NULL,
    PRIMARY KEY (session_id, model, ttl_seconds),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
)
```

## `session_cache_windows`

Kind: **table**; WITHOUT ROWID: False; STRICT: False. Disposition: **KEEP** — Active materialized analytics read model; source events/provider snapshots remain authoritative. Retain the table while reviewing individual persistence-only fields. Frozen snapshot: 531 exact rows. The measured population supports retaining this active read model; occupancy alone does not prove every column needs persistence.

| Column | Declared type | NOT NULL | Default | PK ordinal | Hidden/generated code | Disposition |
| --- | --- | --- | --- | --- | --- | --- |
| `session_id` | TEXT | True | none | 1 | 0 | KEEP |
| `window_index` | INTEGER | True | none | 2 | 0 | KEEP |
| `idle_start` | TEXT | True | none | 0 | 0 | DEPRECATE_REMOVE_CANDIDATE |
| `resume_at` | TEXT | False | none | 0 | 0 | KEEP |
| `idle_seconds` | INTEGER | False | none | 0 | 0 | KEEP |
| `model` | TEXT | False | none | 0 | 0 | KEEP |
| `expires_at` | TEXT | False | none | 0 | 0 | DEPRECATE_REMOVE_CANDIDATE |
| `ttl_seconds` | INTEGER | False | none | 0 | 0 | DEPRECATE_REMOVE_CANDIDATE |
| `outcome` | TEXT | True | none | 0 | 0 | KEEP |
| `resume_source` | TEXT | False | none | 0 | 0 | KEEP |
| `prefix_tokens` | INTEGER | False | none | 0 | 0 | KEEP |
| `interaction_nano_aiu` | INTEGER | False | none | 0 | 0 | DEPRECATE_REMOVE_CANDIDATE |
| `change_kinds` | TEXT | False | none | 0 | 0 | KEEP |

Hidden code: 0 ordinary; 1 virtual hidden; 2 virtual generated; 3 stored generated.

Implicit `rowid` / `_rowid_` / `oid`: **KEEP**, engine integer identity; separate from declared primary key. Used by SQLite B-trees; FTS content row identities are additionally part of synchronization. No extra allocated column is claimed.

### Keys, relationships and DDL

- `sqlite_autoindex_session_cache_windows_1`: unique=True, origin=pk, partial=False; index_xinfo `[[0, 0, "session_id", 0, "BINARY", 1], [1, 1, "window_index", 0, "BINARY", 1], [2, -1, null, 0, "BINARY", 0]]`.
- Foreign key `[0, 0, "sessions", "session_id", "id", "NO ACTION", "CASCADE", "NONE"]` (id, seq, target table, from, to, update, delete, match).

Index tuples are `(sequence, cid, name, descending, collation, key)`; cid -1 denotes rowid, -2 an expression. Origin `pk`/`u` identifies constraint-owned autoindexes.

`table session_cache_windows`:

```sql
CREATE TABLE session_cache_windows (
    session_id TEXT NOT NULL,
    window_index INTEGER NOT NULL,
    idle_start TEXT NOT NULL,
    resume_at TEXT,
    idle_seconds INTEGER,
    model TEXT,
    expires_at TEXT,
    ttl_seconds INTEGER,
    outcome TEXT NOT NULL,
    -- NULL for a user prompt; "system", or "agent" when the agent woke itself.
    resume_source TEXT,
    prefix_tokens INTEGER,
    interaction_nano_aiu INTEGER,
    -- Comma-separated prefix-change kinds (e.g. "tools,history").
    change_kinds TEXT,
    PRIMARY KEY (session_id, window_index),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
)
```

## `session_format_observations`

Kind: **table**; WITHOUT ROWID: False; STRICT: False. Disposition: **KEEP** — Active materialized analytics read model; source events/provider snapshots remain authoritative. Retain the table while reviewing individual persistence-only fields. Frozen snapshot: 646 exact rows. The measured population supports retaining this active read model; occupancy alone does not prove every column needs persistence.

| Column | Declared type | NOT NULL | Default | PK ordinal | Hidden/generated code | Disposition |
| --- | --- | --- | --- | --- | --- | --- |
| `session_id` | TEXT | True | none | 1 | 0 | KEEP |
| `kind` | TEXT | True | none | 2 | 0 | KEEP |
| `name` | TEXT | True | none | 3 | 0 | KEEP |
| `record_count` | INTEGER | True | 0 | 0 | 0 | KEEP |

Hidden code: 0 ordinary; 1 virtual hidden; 2 virtual generated; 3 stored generated.

Implicit `rowid` / `_rowid_` / `oid`: **KEEP**, engine integer identity; separate from declared primary key. Used by SQLite B-trees; FTS content row identities are additionally part of synchronization. No extra allocated column is claimed.

### Keys, relationships and DDL

- `sqlite_autoindex_session_format_observations_1`: unique=True, origin=pk, partial=False; index_xinfo `[[0, 0, "session_id", 0, "BINARY", 1], [1, 1, "kind", 0, "BINARY", 1], [2, 2, "name", 0, "BINARY", 1], [3, -1, null, 0, "BINARY", 0]]`.
- Foreign key `[0, 0, "sessions", "session_id", "id", "NO ACTION", "CASCADE", "NONE"]` (id, seq, target table, from, to, update, delete, match).

Index tuples are `(sequence, cid, name, descending, collation, key)`; cid -1 denotes rowid, -2 an expression. Origin `pk`/`u` identifies constraint-owned autoindexes.

`table session_format_observations`:

```sql
CREATE TABLE session_format_observations (
                  session_id TEXT NOT NULL,
                  kind TEXT NOT NULL,
                  name TEXT NOT NULL,
                  record_count INTEGER NOT NULL DEFAULT 0,
                  PRIMARY KEY (session_id, kind, name),
                  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
              )
```

## `session_incidents`

Kind: **table**; WITHOUT ROWID: False; STRICT: False. Disposition: **KEEP** — Bounded normalized per-incident detail cache for session drill-down; all-event parent counters deliberately differ from capped detail row count. Measured snapshot: 1,003 rows; see [statistics](statistics.md#session_incidents) and [physical storage](storage.md). Table B-tree alone allocates 12,148,736 bytes (10,108,928 included overflow bytes); this excludes separate indexes and is not per-column savings.

| Column | Declared type | NOT NULL | Default | PK ordinal | Hidden/generated code | Disposition |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | INTEGER | False | none | 1 | 0 | KEEP |
| `session_id` | TEXT | True | none | 0 | 0 | KEEP |
| `event_type` | TEXT | True | none | 0 | 0 | KEEP |
| `source_event_type` | TEXT | True | none | 0 | 0 | KEEP |
| `timestamp` | TEXT | False | none | 0 | 0 | KEEP |
| `severity` | TEXT | False | none | 0 | 0 | KEEP |
| `summary` | TEXT | False | none | 0 | 0 | KEEP |
| `detail_json` | TEXT | False | none | 0 | 0 | KEEP |

Hidden code: 0 ordinary; 1 virtual hidden; 2 virtual generated; 3 stored generated.

Implicit `rowid` / `_rowid_` / `oid`: **KEEP**, alias of `id` (same value/storage). Used by SQLite B-trees; FTS content row identities are additionally part of synchronization. No extra allocated column is claimed.

### Keys, relationships and DDL

- `idx_session_incidents_type`: unique=False, origin=c, partial=False; index_xinfo `[[0, 2, "event_type", 0, "BINARY", 1], [1, -1, null, 0, "BINARY", 0]]`.
- `idx_session_incidents_session`: unique=False, origin=c, partial=False; index_xinfo `[[0, 1, "session_id", 0, "BINARY", 1], [1, 4, "timestamp", 0, "BINARY", 1], [2, -1, null, 0, "BINARY", 0]]`.
- Foreign key `[0, 0, "sessions", "session_id", "id", "NO ACTION", "CASCADE", "NONE"]` (id, seq, target table, from, to, update, delete, match).

Index tuples are `(sequence, cid, name, descending, collation, key)`; cid -1 denotes rowid, -2 an expression. Origin `pk`/`u` identifies constraint-owned autoindexes.

`index idx_session_incidents_session`:

```sql
CREATE INDEX idx_session_incidents_session ON session_incidents(session_id, timestamp)
```

`index idx_session_incidents_type`:

```sql
CREATE INDEX idx_session_incidents_type ON session_incidents(event_type)
```

`table session_incidents`:

```sql
CREATE TABLE session_incidents (
    id INTEGER PRIMARY KEY,
    session_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    source_event_type TEXT NOT NULL,
    timestamp TEXT,
    severity TEXT,
    summary TEXT,
    detail_json TEXT,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
)
```

## `session_model_metrics`

Kind: **table**; WITHOUT ROWID: False; STRICT: False. Disposition: **KEEP** — Active materialized analytics read model; source events/provider snapshots remain authoritative. Retain the table while reviewing individual persistence-only fields. Frozen snapshot: 1,142 exact rows. The measured population supports retaining this active read model; occupancy alone does not prove every column needs persistence.

| Column | Declared type | NOT NULL | Default | PK ordinal | Hidden/generated code | Disposition |
| --- | --- | --- | --- | --- | --- | --- |
| `session_id` | TEXT | True | none | 1 | 0 | KEEP |
| `model_name` | TEXT | True | none | 2 | 0 | KEEP |
| `input_tokens` | INTEGER | False | 0 | 0 | 0 | KEEP |
| `output_tokens` | INTEGER | False | 0 | 0 | 0 | KEEP |
| `cache_read_tokens` | INTEGER | False | 0 | 0 | 0 | KEEP |
| `cache_write_tokens` | INTEGER | False | 0 | 0 | 0 | KEEP |
| `cost` | REAL | False | 0 | 0 | 0 | KEEP |
| `request_count` | INTEGER | False | 0 | 0 | 0 | KEEP |
| `reasoning_tokens` | INTEGER | False | none | 0 | 0 | KEEP |
| `total_nano_aiu` | INTEGER | False | none | 0 | 0 | KEEP |
| `cost_usd` | REAL | False | none | 0 | 0 | KEEP |

Hidden code: 0 ordinary; 1 virtual hidden; 2 virtual generated; 3 stored generated.

Implicit `rowid` / `_rowid_` / `oid`: **KEEP**, engine integer identity; separate from declared primary key. Used by SQLite B-trees; FTS content row identities are additionally part of synchronization. No extra allocated column is claimed.

### Keys, relationships and DDL

- `sqlite_autoindex_session_model_metrics_1`: unique=True, origin=pk, partial=False; index_xinfo `[[0, 0, "session_id", 0, "BINARY", 1], [1, 1, "model_name", 0, "BINARY", 1], [2, -1, null, 0, "BINARY", 0]]`.
- Foreign key `[0, 0, "sessions", "session_id", "id", "NO ACTION", "CASCADE", "NONE"]` (id, seq, target table, from, to, update, delete, match).

Index tuples are `(sequence, cid, name, descending, collation, key)`; cid -1 denotes rowid, -2 an expression. Origin `pk`/`u` identifies constraint-owned autoindexes.

`table session_model_metrics`:

```sql
CREATE TABLE session_model_metrics (
    session_id TEXT NOT NULL,
    model_name TEXT NOT NULL,
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    cache_read_tokens INTEGER DEFAULT 0,
    cache_write_tokens INTEGER DEFAULT 0,
    cost REAL DEFAULT 0,
    request_count INTEGER DEFAULT 0, reasoning_tokens INTEGER, total_nano_aiu INTEGER, cost_usd REAL,
    PRIMARY KEY (session_id, model_name),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
)
```

## `session_modified_files`

Kind: **table**; WITHOUT ROWID: False; STRICT: False. Disposition: **KEEP** — Source-reported modified file membership per session, not line-level history. Code Impact consumes path/extension aggregates; reconstructed after reindex. Measured snapshot: 5,719 rows; see [statistics](statistics.md#session_modified_files) and [physical storage](storage.md). Table B-tree alone allocates 724,992 bytes (0 included overflow bytes); this excludes separate indexes and is not per-column savings.

| Column | Declared type | NOT NULL | Default | PK ordinal | Hidden/generated code | Disposition |
| --- | --- | --- | --- | --- | --- | --- |
| `session_id` | TEXT | True | none | 1 | 0 | KEEP |
| `file_path` | TEXT | True | none | 2 | 0 | KEEP |
| `extension` | TEXT | False | none | 0 | 0 | KEEP |

Hidden code: 0 ordinary; 1 virtual hidden; 2 virtual generated; 3 stored generated.

Implicit `rowid` / `_rowid_` / `oid`: **KEEP**, engine integer identity; separate from declared primary key. Used by SQLite B-trees; FTS content row identities are additionally part of synchronization. No extra allocated column is claimed.

### Keys, relationships and DDL

- `sqlite_autoindex_session_modified_files_1`: unique=True, origin=pk, partial=False; index_xinfo `[[0, 0, "session_id", 0, "BINARY", 1], [1, 1, "file_path", 0, "BINARY", 1], [2, -1, null, 0, "BINARY", 0]]`.
- Foreign key `[0, 0, "sessions", "session_id", "id", "NO ACTION", "CASCADE", "NONE"]` (id, seq, target table, from, to, update, delete, match).

Index tuples are `(sequence, cid, name, descending, collation, key)`; cid -1 denotes rowid, -2 an expression. Origin `pk`/`u` identifies constraint-owned autoindexes.

`table session_modified_files`:

```sql
CREATE TABLE session_modified_files (
    session_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    extension TEXT,
    PRIMARY KEY (session_id, file_path),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
)
```

## `session_native_tool_calls`

Kind: **table**; WITHOUT ROWID: False; STRICT: False. Disposition: **KEEP** — Active materialized analytics read model; source events/provider snapshots remain authoritative. Retain the table while reviewing individual persistence-only fields. Frozen snapshot: 851 exact rows. The measured population supports retaining this active read model; occupancy alone does not prove every column needs persistence.

| Column | Declared type | NOT NULL | Default | PK ordinal | Hidden/generated code | Disposition |
| --- | --- | --- | --- | --- | --- | --- |
| `session_id` | TEXT | True | none | 1 | 0 | KEEP |
| `tool_name` | TEXT | True | none | 2 | 0 | KEEP |
| `native_tool_name` | TEXT | True | none | 3 | 0 | KEEP |
| `call_count` | INTEGER | True | 0 | 0 | 0 | KEEP |
| `success_count` | INTEGER | True | 0 | 0 | 0 | KEEP |
| `failure_count` | INTEGER | True | 0 | 0 | 0 | KEEP |
| `total_duration_ms` | INTEGER | True | 0 | 0 | 0 | KEEP |
| `calls_with_duration` | INTEGER | True | 0 | 0 | 0 | KEEP |

Hidden code: 0 ordinary; 1 virtual hidden; 2 virtual generated; 3 stored generated.

Implicit `rowid` / `_rowid_` / `oid`: **KEEP**, engine integer identity; separate from declared primary key. Used by SQLite B-trees; FTS content row identities are additionally part of synchronization. No extra allocated column is claimed.

### Keys, relationships and DDL

- `sqlite_autoindex_session_native_tool_calls_1`: unique=True, origin=pk, partial=False; index_xinfo `[[0, 0, "session_id", 0, "BINARY", 1], [1, 1, "tool_name", 0, "BINARY", 1], [2, 2, "native_tool_name", 0, "BINARY", 1], [3, -1, null, 0, "BINARY", 0]]`.
- Foreign key `[0, 0, "sessions", "session_id", "id", "NO ACTION", "CASCADE", "NONE"]` (id, seq, target table, from, to, update, delete, match).

Index tuples are `(sequence, cid, name, descending, collation, key)`; cid -1 denotes rowid, -2 an expression. Origin `pk`/`u` identifies constraint-owned autoindexes.

`table session_native_tool_calls`:

```sql
CREATE TABLE session_native_tool_calls (
                  session_id TEXT NOT NULL,
                  tool_name TEXT NOT NULL,
                  native_tool_name TEXT NOT NULL,
                  call_count INTEGER NOT NULL DEFAULT 0,
                  success_count INTEGER NOT NULL DEFAULT 0,
                  failure_count INTEGER NOT NULL DEFAULT 0, total_duration_ms INTEGER NOT NULL DEFAULT 0, calls_with_duration INTEGER NOT NULL DEFAULT 0,
                  PRIMARY KEY (session_id, tool_name, native_tool_name),
                  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
              )
```

## `session_segments`

Kind: **table**; WITHOUT ROWID: False; STRICT: False. Disposition: **KEEP** — Active materialized analytics read model; source events/provider snapshots remain authoritative. Retain the table while reviewing individual persistence-only fields. Frozen snapshot: 715 exact rows. The measured population supports retaining this active read model; occupancy alone does not prove every column needs persistence.

| Column | Declared type | NOT NULL | Default | PK ordinal | Hidden/generated code | Disposition |
| --- | --- | --- | --- | --- | --- | --- |
| `session_id` | TEXT | True | none | 1 | 0 | KEEP |
| `start_timestamp` | TEXT | True | none | 0 | 0 | DEPRECATE_REMOVE_CANDIDATE |
| `end_timestamp` | TEXT | True | none | 2 | 0 | KEEP |
| `total_tokens` | INTEGER | False | 0 | 0 | 0 | KEEP |
| `total_requests` | INTEGER | False | 0 | 0 | 0 | DEPRECATE_REMOVE_CANDIDATE |
| `total_premium_requests` | REAL | False | 0.0 | 0 | 0 | KEEP |
| `total_api_duration_ms` | INTEGER | False | 0 | 0 | 0 | DEPRECATE_REMOVE_CANDIDATE |
| `current_model` | TEXT | False | none | 0 | 0 | DEPRECATE_REMOVE_CANDIDATE |
| `model_metrics_json` | TEXT | False | none | 0 | 0 | KEEP |
| `total_nano_aiu` | INTEGER | False | none | 0 | 0 | DEPRECATE_REMOVE_CANDIDATE |
| `cost_usd` | REAL | False | none | 0 | 0 | KEEP |

Hidden code: 0 ordinary; 1 virtual hidden; 2 virtual generated; 3 stored generated.

Implicit `rowid` / `_rowid_` / `oid`: **KEEP**, engine integer identity; separate from declared primary key. Used by SQLite B-trees; FTS content row identities are additionally part of synchronization. No extra allocated column is claimed.

### Keys, relationships and DDL

- `idx_session_segments_end_ts`: unique=False, origin=c, partial=False; index_xinfo `[[0, 2, "end_timestamp", 0, "BINARY", 1], [1, -1, null, 0, "BINARY", 0]]`.
- `sqlite_autoindex_session_segments_1`: unique=True, origin=pk, partial=False; index_xinfo `[[0, 0, "session_id", 0, "BINARY", 1], [1, 2, "end_timestamp", 0, "BINARY", 1], [2, -1, null, 0, "BINARY", 0]]`.
- Foreign key `[0, 0, "sessions", "session_id", "id", "NO ACTION", "CASCADE", "NONE"]` (id, seq, target table, from, to, update, delete, match).

Index tuples are `(sequence, cid, name, descending, collation, key)`; cid -1 denotes rowid, -2 an expression. Origin `pk`/`u` identifies constraint-owned autoindexes.

`index idx_session_segments_end_ts`:

```sql
CREATE INDEX idx_session_segments_end_ts
    ON session_segments(end_timestamp)
```

`table session_segments`:

```sql
CREATE TABLE session_segments (
    session_id TEXT NOT NULL,
    start_timestamp TEXT NOT NULL,
    end_timestamp TEXT NOT NULL,
    total_tokens INTEGER DEFAULT 0,
    total_requests INTEGER DEFAULT 0,
    total_premium_requests REAL DEFAULT 0.0,
    total_api_duration_ms INTEGER DEFAULT 0,
    current_model TEXT,
    model_metrics_json TEXT, total_nano_aiu INTEGER, cost_usd REAL,
    PRIMARY KEY (session_id, end_timestamp),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
)
```

## `session_skill_invocations`

Kind: **table**; WITHOUT ROWID: False; STRICT: False. Disposition: **KEEP** — Active materialized analytics read model; source events/provider snapshots remain authoritative. Retain the table while reviewing individual persistence-only fields. Frozen snapshot: 181 exact rows. The measured population supports retaining this active read model; occupancy alone does not prove every column needs persistence.

| Column | Declared type | NOT NULL | Default | PK ordinal | Hidden/generated code | Disposition |
| --- | --- | --- | --- | --- | --- | --- |
| `session_id` | TEXT | True | none | 1 | 0 | KEEP |
| `event_index` | INTEGER | True | none | 2 | 0 | KEEP |
| `turn_index` | INTEGER | True | none | 0 | 0 | KEEP |
| `tool_call_id` | TEXT | False | none | 0 | 0 | DEPRECATE_REMOVE_CANDIDATE |
| `timestamp` | TEXT | False | none | 0 | 0 | KEEP |
| `skill_name` | TEXT | True | none | 0 | 0 | KEEP |
| `normalized_name` | TEXT | True | none | 0 | 0 | KEEP |
| `skill_path` | TEXT | False | none | 0 | 0 | KEEP |
| `normalized_directory` | TEXT | False | none | 0 | 0 | KEEP |
| `description` | TEXT | False | none | 0 | 0 | KEEP |
| `source` | TEXT | False | none | 0 | 0 | KEEP |
| `trigger` | TEXT | False | none | 0 | 0 | KEEP |
| `agent_id` | TEXT | False | none | 0 | 0 | KEEP |
| `agent_name` | TEXT | False | none | 0 | 0 | KEEP |
| `model` | TEXT | False | none | 0 | 0 | KEEP |
| `plugin_name` | TEXT | False | none | 0 | 0 | KEEP |
| `plugin_version` | TEXT | False | none | 0 | 0 | DEPRECATE_REMOVE_CANDIDATE |
| `content_sha256` | TEXT | False | none | 0 | 0 | KEEP |
| `frontmatter_tokens` | INTEGER | False | none | 0 | 0 | KEEP |
| `instruction_tokens` | INTEGER | False | none | 0 | 0 | KEEP |
| `origin` | TEXT | True | none | 0 | 0 | KEEP |

Hidden code: 0 ordinary; 1 virtual hidden; 2 virtual generated; 3 stored generated.

Implicit `rowid` / `_rowid_` / `oid`: **KEEP**, engine integer identity; separate from declared primary key. Used by SQLite B-trees; FTS content row identities are additionally part of synchronization. No extra allocated column is claimed.

### Keys, relationships and DDL

- `idx_skill_invocations_ts`: unique=False, origin=c, partial=False; index_xinfo `[[0, 4, "timestamp", 0, "BINARY", 1], [1, -1, null, 0, "BINARY", 0]]`.
- `idx_skill_invocations_name_ts`: unique=False, origin=c, partial=False; index_xinfo `[[0, 6, "normalized_name", 0, "BINARY", 1], [1, 4, "timestamp", 0, "BINARY", 1], [2, -1, null, 0, "BINARY", 0]]`.
- `sqlite_autoindex_session_skill_invocations_1`: unique=True, origin=pk, partial=False; index_xinfo `[[0, 0, "session_id", 0, "BINARY", 1], [1, 1, "event_index", 0, "BINARY", 1], [2, -1, null, 0, "BINARY", 0]]`.
- Foreign key `[0, 0, "sessions", "session_id", "id", "NO ACTION", "CASCADE", "NONE"]` (id, seq, target table, from, to, update, delete, match).

Index tuples are `(sequence, cid, name, descending, collation, key)`; cid -1 denotes rowid, -2 an expression. Origin `pk`/`u` identifies constraint-owned autoindexes.

`index idx_skill_invocations_name_ts`:

```sql
CREATE INDEX idx_skill_invocations_name_ts
    ON session_skill_invocations(normalized_name, timestamp)
```

`index idx_skill_invocations_ts`:

```sql
CREATE INDEX idx_skill_invocations_ts
    ON session_skill_invocations(timestamp)
```

`table session_skill_invocations`:

```sql
CREATE TABLE session_skill_invocations (
    session_id TEXT NOT NULL,
    -- Index of the source event in the session's event stream. Unique within
    -- a session, and the deep-link target for the Conversation tab.
    event_index INTEGER NOT NULL,
    -- Main-conversation turn, from the same state machine the Conversation
    -- tab uses.
    turn_index INTEGER NOT NULL,
    tool_call_id TEXT,
    timestamp TEXT,
    -- The name exactly as recorded, plus its case-folded identity key.
    skill_name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    -- Recorded SKILL.md path, and the case-folded directory it lives in.
    -- Both NULL for SDK-provided skills, which record no path.
    skill_path TEXT,
    normalized_directory TEXT,
    description TEXT,
    -- event.source, e.g. "project" | "personal-copilot" (CLI 1.0.49+).
    source TEXT,
    -- "user-invoked" | "agent-invoked" (CLI 1.0.49+); NULL means the CLI did
    -- not record it, which is reported as unknown rather than split.
    trigger TEXT,
    -- Runtime agent instance; NULL for the main agent.
    agent_id TEXT,
    agent_name TEXT,
    model TEXT,
    plugin_name TEXT,
    plugin_version TEXT,
    -- Fingerprint of the invoked content, for drift against the installed
    -- file. NULL for fallback rows.
    content_sha256 TEXT,
    -- Estimated tokens: the frontmatter is the per-turn listing cost, the
    -- pair is what this invocation injected.
    frontmatter_tokens INTEGER,
    instruction_tokens INTEGER,
    -- "event" | "tool_call_fallback" (a skill tool call with no event).
    origin TEXT NOT NULL,
    PRIMARY KEY (session_id, event_index),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
)
```

## `session_tool_calls`

Kind: **table**; WITHOUT ROWID: False; STRICT: False. Disposition: **KEEP** — Active materialized analytics read model; source events/provider snapshots remain authoritative. Retain the table while reviewing individual persistence-only fields. Frozen snapshot: 5,120 exact rows. The measured population supports retaining this active read model; occupancy alone does not prove every column needs persistence.

| Column | Declared type | NOT NULL | Default | PK ordinal | Hidden/generated code | Disposition |
| --- | --- | --- | --- | --- | --- | --- |
| `session_id` | TEXT | True | none | 1 | 0 | KEEP |
| `tool_name` | TEXT | True | none | 2 | 0 | KEEP |
| `call_count` | INTEGER | False | 0 | 0 | 0 | KEEP |
| `success_count` | INTEGER | False | 0 | 0 | 0 | KEEP |
| `failure_count` | INTEGER | False | 0 | 0 | 0 | KEEP |
| `total_duration_ms` | INTEGER | False | 0 | 0 | 0 | KEEP |
| `calls_with_duration` | INTEGER | False | 0 | 0 | 0 | KEEP |

Hidden code: 0 ordinary; 1 virtual hidden; 2 virtual generated; 3 stored generated.

Implicit `rowid` / `_rowid_` / `oid`: **KEEP**, engine integer identity; separate from declared primary key. Used by SQLite B-trees; FTS content row identities are additionally part of synchronization. No extra allocated column is claimed.

### Keys, relationships and DDL

- `sqlite_autoindex_session_tool_calls_1`: unique=True, origin=pk, partial=False; index_xinfo `[[0, 0, "session_id", 0, "BINARY", 1], [1, 1, "tool_name", 0, "BINARY", 1], [2, -1, null, 0, "BINARY", 0]]`.
- Foreign key `[0, 0, "sessions", "session_id", "id", "NO ACTION", "CASCADE", "NONE"]` (id, seq, target table, from, to, update, delete, match).

Index tuples are `(sequence, cid, name, descending, collation, key)`; cid -1 denotes rowid, -2 an expression. Origin `pk`/`u` identifies constraint-owned autoindexes.

`table session_tool_calls`:

```sql
CREATE TABLE session_tool_calls (
    session_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    call_count INTEGER DEFAULT 0,
    success_count INTEGER DEFAULT 0,
    failure_count INTEGER DEFAULT 0,
    total_duration_ms INTEGER DEFAULT 0, calls_with_duration INTEGER DEFAULT 0,
    PRIMARY KEY (session_id, tool_name),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
)
```

## `sessions`

Kind: **table**; WITHOUT ROWID: False; STRICT: False. Disposition: **KEEP** — Canonical provider-owned session identity plus replaceable metadata/analytics cache, joined by every analytics/search surface and used to resolve IPC/export input. Retain table; individual compatibility/candidate fields are reviewed below. Measured snapshot: 729 rows; see [statistics](statistics.md#sessions) and [physical storage](storage.md). Table B-tree alone allocates 786,432 bytes (102,400 included overflow bytes); this excludes separate indexes and is not per-column savings.

| Column | Declared type | NOT NULL | Default | PK ordinal | Hidden/generated code | Disposition |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | TEXT | False | none | 1 | 0 | KEEP |
| `path` | TEXT | True | none | 0 | 0 | KEEP |
| `summary` | TEXT | False | none | 0 | 0 | KEEP |
| `repository` | TEXT | False | none | 0 | 0 | KEEP |
| `branch` | TEXT | False | none | 0 | 0 | KEEP |
| `cwd` | TEXT | False | none | 0 | 0 | KEEP |
| `created_at` | TEXT | False | none | 0 | 0 | KEEP |
| `updated_at` | TEXT | False | none | 0 | 0 | KEEP |
| `event_count` | INTEGER | False | none | 0 | 0 | KEEP |
| `indexed_at` | TEXT | True | datetime('now') | 0 | 0 | INSUFFICIENT_EVIDENCE |
| `host_type` | TEXT | False | none | 0 | 0 | KEEP |
| `turn_count` | INTEGER | False | none | 0 | 0 | KEEP |
| `current_model` | TEXT | False | none | 0 | 0 | KEEP |
| `total_premium_requests` | REAL | False | none | 0 | 0 | KEEP |
| `total_api_duration_ms` | INTEGER | False | none | 0 | 0 | KEEP |
| `workspace_mtime` | TEXT | False | none | 0 | 0 | CONSOLIDATE |
| `total_tokens` | INTEGER | False | none | 0 | 0 | KEEP |
| `total_cost` | REAL | False | none | 0 | 0 | CHANGE |
| `tool_call_count` | INTEGER | False | none | 0 | 0 | KEEP |
| `lines_added` | INTEGER | False | none | 0 | 0 | KEEP |
| `lines_removed` | INTEGER | False | none | 0 | 0 | KEEP |
| `events_mtime` | TEXT | False | none | 0 | 0 | CONSOLIDATE |
| `events_size` | INTEGER | False | none | 0 | 0 | KEEP |
| `analytics_version` | INTEGER | False | 1 | 0 | 0 | KEEP |
| `error_count` | INTEGER | False | 0 | 0 | 0 | KEEP |
| `rate_limit_count` | INTEGER | False | 0 | 0 | 0 | KEEP |
| `compaction_count` | INTEGER | False | 0 | 0 | 0 | KEEP |
| `truncation_count` | INTEGER | False | 0 | 0 | 0 | KEEP |
| `total_compaction_input_tokens` | INTEGER | False | 0 | 0 | 0 | DEPRECATE_REMOVE_CANDIDATE |
| `total_compaction_output_tokens` | INTEGER | False | 0 | 0 | 0 | DEPRECATE_REMOVE_CANDIDATE |
| `search_indexed_at` | TEXT | False | none | 0 | 0 | KEEP |
| `search_extractor_version` | INTEGER | False | 0 | 0 | 0 | KEEP |
| `copilot_version` | TEXT | False | none | 0 | 0 | KEEP |
| `total_nano_aiu` | INTEGER | False | none | 0 | 0 | KEEP |
| `source_fingerprint` | TEXT | False | none | 0 | 0 | KEEP |
| `search_source_fingerprint` | TEXT | False | none | 0 | 0 | KEEP |
| `source` | TEXT | True | 'copilot' | 0 | 0 | KEEP |
| `parent_session_id` | TEXT | False | none | 0 | 0 | KEEP |
| `role` | TEXT | True | 'primary' | 0 | 0 | KEEP |
| `hidden` | INTEGER | True | 0 | 0 | 0 | INSUFFICIENT_EVIDENCE |
| `source_format_version` | TEXT | False | none | 0 | 0 | INSUFFICIENT_EVIDENCE |
| `cost_usd` | REAL | False | none | 0 | 0 | KEEP |

Hidden code: 0 ordinary; 1 virtual hidden; 2 virtual generated; 3 stored generated.

Implicit `rowid` / `_rowid_` / `oid`: **KEEP**, engine integer identity; separate from declared primary key. Used by SQLite B-trees; FTS content row identities are additionally part of synchronization. No extra allocated column is claimed.

### Keys, relationships and DDL

- `idx_sessions_source`: unique=False, origin=c, partial=False; index_xinfo `[[0, 36, "source", 0, "BINARY", 1], [1, -1, null, 0, "BINARY", 0]]`.
- `idx_sessions_nonempty_updated_at`: unique=False, origin=c, partial=True; index_xinfo `[[0, 7, "updated_at", 1, "BINARY", 1], [1, -1, null, 0, "BINARY", 0]]`.
- `idx_sessions_repo_updated`: unique=False, origin=c, partial=False; index_xinfo `[[0, 3, "repository", 0, "BINARY", 1], [1, 7, "updated_at", 0, "BINARY", 1], [2, -1, null, 0, "BINARY", 0]]`.
- `idx_sessions_updated_at`: unique=False, origin=c, partial=False; index_xinfo `[[0, 7, "updated_at", 0, "BINARY", 1], [1, -1, null, 0, "BINARY", 0]]`.
- `sqlite_autoindex_sessions_1`: unique=True, origin=pk, partial=False; index_xinfo `[[0, 0, "id", 0, "BINARY", 1], [1, -1, null, 0, "BINARY", 0]]`.

Index tuples are `(sequence, cid, name, descending, collation, key)`; cid -1 denotes rowid, -2 an expression. Origin `pk`/`u` identifies constraint-owned autoindexes.

`index idx_sessions_nonempty_updated_at`:

```sql
CREATE INDEX idx_sessions_nonempty_updated_at
    ON sessions(updated_at DESC)
    WHERE turn_count IS NOT NULL AND turn_count > 0
```

`index idx_sessions_repo_updated`:

```sql
CREATE INDEX idx_sessions_repo_updated ON sessions(repository, updated_at)
```

`index idx_sessions_source`:

```sql
CREATE INDEX idx_sessions_source ON sessions(source)
```

`index idx_sessions_updated_at`:

```sql
CREATE INDEX idx_sessions_updated_at ON sessions(updated_at)
```

`table sessions`:

```sql
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL,
    summary TEXT,
    repository TEXT,
    branch TEXT,
    cwd TEXT,
    created_at TEXT,
    updated_at TEXT,
    event_count INTEGER,
    indexed_at TEXT NOT NULL DEFAULT (datetime('now'))
, host_type TEXT, turn_count INTEGER, current_model TEXT, total_premium_requests REAL, total_api_duration_ms INTEGER, workspace_mtime TEXT, total_tokens INTEGER, total_cost REAL, tool_call_count INTEGER, lines_added INTEGER, lines_removed INTEGER, events_mtime TEXT, events_size INTEGER, analytics_version INTEGER DEFAULT 1, error_count INTEGER DEFAULT 0, rate_limit_count INTEGER DEFAULT 0, compaction_count INTEGER DEFAULT 0, truncation_count INTEGER DEFAULT 0, total_compaction_input_tokens INTEGER DEFAULT 0, total_compaction_output_tokens INTEGER DEFAULT 0, search_indexed_at TEXT, search_extractor_version INTEGER DEFAULT 0, copilot_version TEXT, total_nano_aiu INTEGER, source_fingerprint TEXT, search_source_fingerprint TEXT, source TEXT NOT NULL DEFAULT 'copilot', parent_session_id TEXT, role TEXT NOT NULL DEFAULT 'primary', hidden INTEGER NOT NULL DEFAULT 0, source_format_version TEXT, cost_usd REAL)
```

`trigger sessions_ad`:

```sql
CREATE TRIGGER sessions_ad AFTER DELETE ON sessions BEGIN
    INSERT INTO sessions_fts(sessions_fts, rowid, id, summary, repository, branch)
    VALUES ('delete', old.rowid, old.id, old.summary, old.repository, old.branch);
END
```

`trigger sessions_ai`:

```sql
CREATE TRIGGER sessions_ai AFTER INSERT ON sessions BEGIN
    INSERT INTO sessions_fts(rowid, id, summary, repository, branch)
    VALUES (new.rowid, new.id, new.summary, new.repository, new.branch);
END
```

`trigger sessions_au`:

```sql
CREATE TRIGGER sessions_au AFTER UPDATE ON sessions BEGIN
    INSERT INTO sessions_fts(sessions_fts, rowid, id, summary, repository, branch)
    VALUES ('delete', old.rowid, old.id, old.summary, old.repository, old.branch);
    INSERT INTO sessions_fts(rowid, id, summary, repository, branch)
    VALUES (new.rowid, new.id, new.summary, new.repository, new.branch);
END
```

## `sessions_fts`

Kind: **virtual**; WITHOUT ROWID: False; STRICT: False. Disposition: **KEEP** — FTS5 external-content index over sessions; generated terms and engine state are maintained by triggers/rebuild paths. Not duplicate removable application storage. Frozen snapshot evidence: 729 rows; virtual external-content rows have no independently attributed table b-tree. Occupancy does not replace the source/engine-use rationale.

| Column | Declared type | NOT NULL | Default | PK ordinal | Hidden/generated code | Disposition |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | (none) | False | none | 0 | 0 | KEEP |
| `summary` | (none) | False | none | 0 | 0 | KEEP |
| `repository` | (none) | False | none | 0 | 0 | KEEP |
| `branch` | (none) | False | none | 0 | 0 | KEEP |
| `sessions_fts` | (none) | False | none | 0 | 1 | KEEP |
| `rank` | (none) | False | none | 0 | 1 | KEEP |

Hidden code: 0 ordinary; 1 virtual hidden; 2 virtual generated; 3 stored generated.

Implicit `rowid` / `_rowid_` / `oid`: **KEEP**, engine integer identity; separate from declared primary key. Used by SQLite B-trees; FTS content row identities are additionally part of synchronization. No extra allocated column is claimed.

### Keys, relationships and DDL

No separately listed index or foreign key.

Index tuples are `(sequence, cid, name, descending, collation, key)`; cid -1 denotes rowid, -2 an expression. Origin `pk`/`u` identifies constraint-owned autoindexes.

`table sessions_fts`:

```sql
CREATE VIRTUAL TABLE sessions_fts USING fts5(
    id, summary, repository, branch,
    content='sessions',
    content_rowid='rowid',
    tokenize='unicode61'
)
```

## `sessions_fts_config`

Kind: **shadow**; WITHOUT ROWID: True; STRICT: False. Disposition: **KEEP** — SQLite FTS5 config shadow storage for sessions_fts; ownership and hidden use follow virtual table definition, not direct application references. Frozen snapshot evidence: 1 rows, 4,096 physical b-tree bytes. Occupancy does not replace the source/engine-use rationale.

| Column | Declared type | NOT NULL | Default | PK ordinal | Hidden/generated code | Disposition |
| --- | --- | --- | --- | --- | --- | --- |
| `k` | (none) | True | none | 1 | 0 | KEEP |
| `v` | (none) | False | none | 0 | 0 | KEEP |

Hidden code: 0 ordinary; 1 virtual hidden; 2 virtual generated; 3 stored generated.

No implicit rowid (WITHOUT ROWID).

### Keys, relationships and DDL

- `sqlite_autoindex_sessions_fts_config_1`: unique=True, origin=pk, partial=False; index_xinfo `[[0, 0, "k", 0, "BINARY", 1], [1, 1, "v", 0, "BINARY", 0]]`.

Index tuples are `(sequence, cid, name, descending, collation, key)`; cid -1 denotes rowid, -2 an expression. Origin `pk`/`u` identifies constraint-owned autoindexes.

`table sessions_fts_config`:

```sql
CREATE TABLE 'sessions_fts_config'(k PRIMARY KEY, v) WITHOUT ROWID
```

## `sessions_fts_data`

Kind: **shadow**; WITHOUT ROWID: False; STRICT: False. Disposition: **KEEP** — SQLite FTS5 data shadow storage for sessions_fts; ownership and hidden use follow virtual table definition, not direct application references. Frozen snapshot evidence: 61 rows, 245,760 physical b-tree bytes. Occupancy does not replace the source/engine-use rationale.

| Column | Declared type | NOT NULL | Default | PK ordinal | Hidden/generated code | Disposition |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | INTEGER | False | none | 1 | 0 | KEEP |
| `block` | BLOB | False | none | 0 | 0 | KEEP |

Hidden code: 0 ordinary; 1 virtual hidden; 2 virtual generated; 3 stored generated.

Implicit `rowid` / `_rowid_` / `oid`: **KEEP**, alias of `id` (same value/storage). Used by SQLite B-trees; FTS content row identities are additionally part of synchronization. No extra allocated column is claimed.

### Keys, relationships and DDL

No separately listed index or foreign key.

Index tuples are `(sequence, cid, name, descending, collation, key)`; cid -1 denotes rowid, -2 an expression. Origin `pk`/`u` identifies constraint-owned autoindexes.

`table sessions_fts_data`:

```sql
CREATE TABLE 'sessions_fts_data'(id INTEGER PRIMARY KEY, block BLOB)
```

## `sessions_fts_docsize`

Kind: **shadow**; WITHOUT ROWID: False; STRICT: False. Disposition: **KEEP** — SQLite FTS5 docsize shadow storage for sessions_fts; ownership and hidden use follow virtual table definition, not direct application references. Frozen snapshot evidence: 729 rows, 16,384 physical b-tree bytes. Occupancy does not replace the source/engine-use rationale.

| Column | Declared type | NOT NULL | Default | PK ordinal | Hidden/generated code | Disposition |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | INTEGER | False | none | 1 | 0 | KEEP |
| `sz` | BLOB | False | none | 0 | 0 | KEEP |

Hidden code: 0 ordinary; 1 virtual hidden; 2 virtual generated; 3 stored generated.

Implicit `rowid` / `_rowid_` / `oid`: **KEEP**, alias of `id` (same value/storage). Used by SQLite B-trees; FTS content row identities are additionally part of synchronization. No extra allocated column is claimed.

### Keys, relationships and DDL

No separately listed index or foreign key.

Index tuples are `(sequence, cid, name, descending, collation, key)`; cid -1 denotes rowid, -2 an expression. Origin `pk`/`u` identifies constraint-owned autoindexes.

`table sessions_fts_docsize`:

```sql
CREATE TABLE 'sessions_fts_docsize'(id INTEGER PRIMARY KEY, sz BLOB)
```

## `sessions_fts_idx`

Kind: **shadow**; WITHOUT ROWID: True; STRICT: False. Disposition: **KEEP** — SQLite FTS5 idx shadow storage for sessions_fts; ownership and hidden use follow virtual table definition, not direct application references. Frozen snapshot evidence: 59 rows, 4,096 physical b-tree bytes. Occupancy does not replace the source/engine-use rationale.

| Column | Declared type | NOT NULL | Default | PK ordinal | Hidden/generated code | Disposition |
| --- | --- | --- | --- | --- | --- | --- |
| `segid` | (none) | True | none | 1 | 0 | KEEP |
| `term` | (none) | True | none | 2 | 0 | KEEP |
| `pgno` | (none) | False | none | 0 | 0 | KEEP |

Hidden code: 0 ordinary; 1 virtual hidden; 2 virtual generated; 3 stored generated.

No implicit rowid (WITHOUT ROWID).

### Keys, relationships and DDL

- `sqlite_autoindex_sessions_fts_idx_1`: unique=True, origin=pk, partial=False; index_xinfo `[[0, 0, "segid", 0, "BINARY", 1], [1, 1, "term", 0, "BINARY", 1], [2, 2, "pgno", 0, "BINARY", 0]]`.

Index tuples are `(sequence, cid, name, descending, collation, key)`; cid -1 denotes rowid, -2 an expression. Origin `pk`/`u` identifies constraint-owned autoindexes.

`table sessions_fts_idx`:

```sql
CREATE TABLE 'sessions_fts_idx'(segid, term, pgno, PRIMARY KEY(segid, term)) WITHOUT ROWID
```

## `sqlite_schema`

Kind: **table**; WITHOUT ROWID: False; STRICT: False. Disposition: **KEEP** — SQLite-owned metadata; retain under engine ownership. Presence of statistics depends on compile features and maintenance history; sqlite_schema has sqlite_master alias. Measured snapshot: 66 rows; see [statistics](statistics.md#sqlite_schema) and [physical storage](storage.md). Table B-tree alone allocates 24,576 bytes (0 included overflow bytes); this excludes separate indexes and is not per-column savings.

| Column | Declared type | NOT NULL | Default | PK ordinal | Hidden/generated code | Disposition |
| --- | --- | --- | --- | --- | --- | --- |
| `type` | TEXT | False | none | 0 | 0 | KEEP |
| `name` | TEXT | False | none | 0 | 0 | KEEP |
| `tbl_name` | TEXT | False | none | 0 | 0 | KEEP |
| `rootpage` | INT | False | none | 0 | 0 | KEEP |
| `sql` | TEXT | False | none | 0 | 0 | KEEP |

Hidden code: 0 ordinary; 1 virtual hidden; 2 virtual generated; 3 stored generated.

Implicit `rowid` / `_rowid_` / `oid`: **KEEP**, engine integer identity; separate from declared primary key. Used by SQLite B-trees; FTS content row identities are additionally part of synchronization. No extra allocated column is claimed.

### Keys, relationships and DDL

No separately listed index or foreign key.

Index tuples are `(sequence, cid, name, descending, collation, key)`; cid -1 denotes rowid, -2 an expression. Origin `pk`/`u` identifies constraint-owned autoindexes.

`sqlite_schema` is SQLite-managed and does not list itself in its own rows. Its five declared columns are still covered.

## `sqlite_sequence`

Kind: **table**; WITHOUT ROWID: False; STRICT: False. Disposition: **KEEP** — SQLite-owned metadata; retain under engine ownership. Presence of statistics depends on compile features and maintenance history; sqlite_schema has sqlite_master alias. Measured snapshot: 1 rows; see [statistics](statistics.md#sqlite_sequence) and [physical storage](storage.md). Table B-tree alone allocates 4,096 bytes (0 included overflow bytes); this excludes separate indexes and is not per-column savings.

| Column | Declared type | NOT NULL | Default | PK ordinal | Hidden/generated code | Disposition |
| --- | --- | --- | --- | --- | --- | --- |
| `name` | (none) | False | none | 0 | 0 | KEEP |
| `seq` | (none) | False | none | 0 | 0 | KEEP |

Hidden code: 0 ordinary; 1 virtual hidden; 2 virtual generated; 3 stored generated.

Implicit `rowid` / `_rowid_` / `oid`: **KEEP**, engine integer identity; separate from declared primary key. Used by SQLite B-trees; FTS content row identities are additionally part of synchronization. No extra allocated column is claimed.

### Keys, relationships and DDL

No separately listed index or foreign key.

Index tuples are `(sequence, cid, name, descending, collation, key)`; cid -1 denotes rowid, -2 an expression. Origin `pk`/`u` identifies constraint-owned autoindexes.

`table sqlite_sequence`:

```sql
CREATE TABLE sqlite_sequence(name,seq)
```

## `sqlite_stat1`

Kind: **table**; WITHOUT ROWID: False; STRICT: False. Disposition: **KEEP** — SQLite-owned metadata; retain under engine ownership. Presence of statistics depends on compile features and maintenance history; sqlite_schema has sqlite_master alias. Measured snapshot: 35 rows; see [statistics](statistics.md#sqlite_stat1) and [physical storage](storage.md). Table B-tree alone allocates 4,096 bytes (0 included overflow bytes); this excludes separate indexes and is not per-column savings.

| Column | Declared type | NOT NULL | Default | PK ordinal | Hidden/generated code | Disposition |
| --- | --- | --- | --- | --- | --- | --- |
| `tbl` | (none) | False | none | 0 | 0 | KEEP |
| `idx` | (none) | False | none | 0 | 0 | KEEP |
| `stat` | (none) | False | none | 0 | 0 | KEEP |

Hidden code: 0 ordinary; 1 virtual hidden; 2 virtual generated; 3 stored generated.

Implicit `rowid` / `_rowid_` / `oid`: **KEEP**, engine integer identity; separate from declared primary key. Used by SQLite B-trees; FTS content row identities are additionally part of synchronization. No extra allocated column is claimed.

### Keys, relationships and DDL

No separately listed index or foreign key.

Index tuples are `(sequence, cid, name, descending, collation, key)`; cid -1 denotes rowid, -2 an expression. Origin `pk`/`u` identifies constraint-owned autoindexes.

`table sqlite_stat1`:

```sql
CREATE TABLE sqlite_stat1(tbl,idx,stat)
```

## `sqlite_stat4`

Kind: **table**; WITHOUT ROWID: False; STRICT: False. Disposition: **KEEP** — SQLite-owned metadata; retain under engine ownership. Presence of statistics depends on compile features and maintenance history; sqlite_schema has sqlite_master alias. Measured snapshot: 612 rows; see [statistics](statistics.md#sqlite_stat4) and [physical storage](storage.md). Table B-tree alone allocates 90,112 bytes (0 included overflow bytes); this excludes separate indexes and is not per-column savings.

| Column | Declared type | NOT NULL | Default | PK ordinal | Hidden/generated code | Disposition |
| --- | --- | --- | --- | --- | --- | --- |
| `tbl` | (none) | False | none | 0 | 0 | KEEP |
| `idx` | (none) | False | none | 0 | 0 | KEEP |
| `neq` | (none) | False | none | 0 | 0 | KEEP |
| `nlt` | (none) | False | none | 0 | 0 | KEEP |
| `ndlt` | (none) | False | none | 0 | 0 | KEEP |
| `sample` | (none) | False | none | 0 | 0 | KEEP |

Hidden code: 0 ordinary; 1 virtual hidden; 2 virtual generated; 3 stored generated.

Implicit `rowid` / `_rowid_` / `oid`: **KEEP**, engine integer identity; separate from declared primary key. Used by SQLite B-trees; FTS content row identities are additionally part of synchronization. No extra allocated column is claimed.

### Keys, relationships and DDL

No separately listed index or foreign key.

Index tuples are `(sequence, cid, name, descending, collation, key)`; cid -1 denotes rowid, -2 an expression. Origin `pk`/`u` identifies constraint-owned autoindexes.

`table sqlite_stat4`:

```sql
CREATE TABLE sqlite_stat4(tbl,idx,neq,nlt,ndlt,sample)
```
