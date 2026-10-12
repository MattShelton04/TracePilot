# Frozen-snapshot query plans and diagnostic timings

All **136 SELECT shapes** prepared and executed successfully three times on the frozen snapshot using **SQLite 3.42.0**. Ordered output fingerprints stayed stable in this run. The bundled application uses SQLite 3.46.0; these plans and warm-cache diagnostics do not establish its plans or latency. The timers include row iteration, repr encoding and SHA-256 updates, so large-result queries include verification overhead. The five-sample [experiments](experiments.md) exclude hashing from query timers. No private result fingerprints, bindings, content, identifiers or dates appear here.

The [reusable cases](../../scripts/database/cases.json) preserve full source-expanded SQL and synthetic public bindings. The synthetic binding list below is a template: when a selector is listed, the recorded binding method describes replacement from the private frozen corpus, with actual values withheld. Counts report result rows, and scalar counts/totals separately; a COUNT returning one row can still mean zero matches.

FTS snippets use control-byte sentinels. SQL blocks display each byte 0x01 as `\x01` for legibility; the case JSON preserves the actual character. EQP entries are id/parent plus the engine detail. One installation establishes corpus-specific occupancy/selectivity, not product-wide invocation frequency.

## Executed SELECT shapes

### browse-all-page

Deep search/browse page.

```sql
SELECT sc.id, sc.session_id, sc.content_type, sc.turn_number, sc.event_index, sc.timestamp_unix, sc.tool_name, CASE WHEN LENGTH(sc.content) > 200 THEN SUBSTR(sc.content, 1, 200) || '…' ELSE sc.content END, sc.metadata_json, s.summary, s.repository, s.branch, s.updated_at, s.source FROM search_content sc JOIN sessions s ON s.id = sc.session_id WHERE 1=1 ORDER BY sc.timestamp_unix DESC NULLS LAST LIMIT ? OFFSET ?
```

Synthetic bindings: `[50, 0]`. Observed binding method: synthetic.

```text
13 / 0: SCAN sc USING INDEX idx_search_content_timestamp
16 / 0: SEARCH s USING INDEX sqlite_autoindex_sessions_1 (id=?)
```

Result rows: **50**. Three runs, median **0.395 ms**, range **0.376–0.687 ms**; ordered outputs stable.

### browse-all-count

Separate exact count on every page.

```sql
SELECT COUNT(*) FROM search_content sc JOIN sessions s ON s.id = sc.session_id WHERE 1=1
```

Synthetic bindings: `[]`. Observed binding method: synthetic.

```text
5 / 0: SCAN s USING COVERING INDEX sqlite_autoindex_sessions_1
7 / 0: SEARCH sc USING COVERING INDEX idx_search_content_session_event (session_id=?)
```

Result rows: **1**; scalar counts/totals: `[679345]`. Three runs, median **68.108 ms**, range **64.259–76.529 ms**; ordered outputs stable.

### browse-all-facet-type

Facet cache miss; own filter omitted.

```sql
SELECT sc.content_type, COUNT(*) FROM search_content sc JOIN sessions s ON s.id = sc.session_id WHERE 1=1 GROUP BY sc.content_type ORDER BY COUNT(*) DESC
```

Synthetic bindings: `[]`. Observed binding method: synthetic.

```text
10 / 0: SCAN sc USING INDEX idx_search_content_type_ts
13 / 0: SEARCH s USING COVERING INDEX sqlite_autoindex_sessions_1 (id=?)
45 / 0: USE TEMP B-TREE FOR ORDER BY
```

Result rows: **10**. Three runs, median **1,156.151 ms**, range **1,131.662–1,161.341 ms**; ordered outputs stable.

### browse-all-facet-repo

Facet cache miss; own filter omitted.

```sql
SELECT s.repository, COUNT(*) FROM search_content sc JOIN sessions s ON s.id = sc.session_id WHERE 1=1 AND s.repository IS NOT NULL GROUP BY s.repository ORDER BY COUNT(*) DESC LIMIT ?
```

Synthetic bindings: `[20]`. Observed binding method: synthetic.

```text
13 / 0: SEARCH s USING INDEX idx_sessions_repo_updated (repository>?)
18 / 0: SEARCH sc USING COVERING INDEX idx_search_content_session_event (session_id=?)
56 / 0: USE TEMP B-TREE FOR ORDER BY
```

Result rows: **10**. Three runs, median **90.725 ms**, range **88.706–93.521 ms**; ordered outputs stable.

### browse-all-facet-tool

Facet cache miss; own filter omitted.

```sql
SELECT sc.tool_name, COUNT(*) FROM search_content sc JOIN sessions s ON s.id = sc.session_id WHERE 1=1 AND sc.tool_name IS NOT NULL GROUP BY sc.tool_name ORDER BY COUNT(*) DESC LIMIT ?
```

Synthetic bindings: `[20]`. Observed binding method: synthetic.

```text
13 / 0: SEARCH sc USING INDEX idx_search_content_tool (tool_name>?)
18 / 0: SEARCH s USING COVERING INDEX sqlite_autoindex_sessions_1 (id=?)
55 / 0: USE TEMP B-TREE FOR ORDER BY
```

Result rows: **20**. Three runs, median **817.221 ms**, range **816.728–823.089 ms**; ordered outputs stable.

### browse-all-totals

Facet exact total/distinct sessions.

```sql
SELECT COUNT(*), COUNT(DISTINCT sc.session_id) FROM search_content sc JOIN sessions s ON s.id = sc.session_id WHERE 1=1
```

Synthetic bindings: `[]`. Observed binding method: synthetic.

```text
3 / 0: USE TEMP B-TREE FOR count(DISTINCT)
7 / 0: SCAN s USING COVERING INDEX sqlite_autoindex_sessions_1
9 / 0: SEARCH sc USING COVERING INDEX idx_search_content_session_event (session_id=?)
```

Result rows: **1**; scalar counts/totals: `[679345, 510]`. Three runs, median **112.137 ms**, range **111.742–112.147 ms**; ordered outputs stable.

### browse-type-page

Deep search/browse page.

```sql
SELECT sc.id, sc.session_id, sc.content_type, sc.turn_number, sc.event_index, sc.timestamp_unix, sc.tool_name, CASE WHEN LENGTH(sc.content) > 200 THEN SUBSTR(sc.content, 1, 200) || '…' ELSE sc.content END, sc.metadata_json, s.summary, s.repository, s.branch, s.updated_at, s.source FROM search_content sc JOIN sessions s ON s.id = sc.session_id WHERE sc.content_type IN (?) ORDER BY sc.timestamp_unix DESC NULLS LAST LIMIT ? OFFSET ?
```

Synthetic bindings: `["user_message", 50, 0]`. Observed binding method: synthetic.

```text
12 / 0: SEARCH sc USING INDEX idx_search_content_type_ts (content_type=?)
19 / 0: SEARCH s USING INDEX sqlite_autoindex_sessions_1 (id=?)
```

Result rows: **50**. Three runs, median **0.425 ms**, range **0.408–1.039 ms**; ordered outputs stable.

### browse-type-count

Separate exact count on every page.

```sql
SELECT COUNT(*) FROM search_content sc JOIN sessions s ON s.id = sc.session_id WHERE sc.content_type IN (?)
```

Synthetic bindings: `["user_message"]`. Observed binding method: synthetic.

```text
5 / 0: SEARCH sc USING INDEX idx_search_content_type_ts (content_type=?)
12 / 0: SEARCH s USING COVERING INDEX sqlite_autoindex_sessions_1 (id=?)
```

Result rows: **1**; scalar counts/totals: `[2311]`. Three runs, median **1.681 ms**, range **1.311–11.421 ms**; ordered outputs stable.

### browse-type-facet-type

Facet cache miss; own filter omitted.

```sql
SELECT sc.content_type, COUNT(*) FROM search_content sc JOIN sessions s ON s.id = sc.session_id WHERE 1=1 GROUP BY sc.content_type ORDER BY COUNT(*) DESC
```

Synthetic bindings: `[]`. Observed binding method: synthetic.

```text
10 / 0: SCAN sc USING INDEX idx_search_content_type_ts
13 / 0: SEARCH s USING COVERING INDEX sqlite_autoindex_sessions_1 (id=?)
45 / 0: USE TEMP B-TREE FOR ORDER BY
```

Result rows: **10**. Three runs, median **1,144.731 ms**, range **1,139.499–1,212.771 ms**; ordered outputs stable.

### browse-type-facet-repo

Facet cache miss; own filter omitted.

```sql
SELECT s.repository, COUNT(*) FROM search_content sc JOIN sessions s ON s.id = sc.session_id WHERE sc.content_type IN (?) AND s.repository IS NOT NULL GROUP BY s.repository ORDER BY COUNT(*) DESC LIMIT ?
```

Synthetic bindings: `["user_message", 20]`. Observed binding method: synthetic.

```text
12 / 0: SEARCH s USING INDEX idx_sessions_repo_updated (repository>?)
17 / 0: SEARCH sc USING COVERING INDEX idx_search_content_session_ts_type (session_id=?)
57 / 0: USE TEMP B-TREE FOR ORDER BY
```

Result rows: **10**. Three runs, median **119.768 ms**, range **111.961–119.993 ms**; ordered outputs stable.

### browse-type-facet-tool

Facet cache miss; own filter omitted.

```sql
SELECT sc.tool_name, COUNT(*) FROM search_content sc JOIN sessions s ON s.id = sc.session_id WHERE sc.content_type IN (?) AND sc.tool_name IS NOT NULL GROUP BY sc.tool_name ORDER BY COUNT(*) DESC LIMIT ?
```

Synthetic bindings: `["user_message", 20]`. Observed binding method: synthetic.

```text
12 / 0: SEARCH sc USING INDEX idx_search_content_type_ts (content_type=?)
21 / 0: SEARCH s USING COVERING INDEX sqlite_autoindex_sessions_1 (id=?)
25 / 0: USE TEMP B-TREE FOR GROUP BY
66 / 0: USE TEMP B-TREE FOR ORDER BY
```

Result rows: **0**. Three runs, median **1.045 ms**, range **0.820–11.208 ms**; ordered outputs stable.

### browse-type-totals

Facet exact total/distinct sessions.

```sql
SELECT COUNT(*), COUNT(DISTINCT sc.session_id) FROM search_content sc JOIN sessions s ON s.id = sc.session_id WHERE sc.content_type IN (?)
```

Synthetic bindings: `["user_message"]`. Observed binding method: synthetic.

```text
3 / 0: USE TEMP B-TREE FOR count(DISTINCT)
7 / 0: SEARCH sc USING INDEX idx_search_content_type_ts (content_type=?)
14 / 0: SEARCH s USING COVERING INDEX sqlite_autoindex_sessions_1 (id=?)
```

Result rows: **1**; scalar counts/totals: `[2311, 509]`. Three runs, median **2.563 ms**, range **2.301–2.941 ms**; ordered outputs stable.

### browse-tool-page

Deep search/browse page.

```sql
SELECT sc.id, sc.session_id, sc.content_type, sc.turn_number, sc.event_index, sc.timestamp_unix, sc.tool_name, CASE WHEN LENGTH(sc.content) > 200 THEN SUBSTR(sc.content, 1, 200) || '…' ELSE sc.content END, sc.metadata_json, s.summary, s.repository, s.branch, s.updated_at, s.source FROM search_content sc JOIN sessions s ON s.id = sc.session_id WHERE sc.tool_name IN (?) ORDER BY sc.timestamp_unix DESC NULLS LAST LIMIT ? OFFSET ?
```

Synthetic bindings: `["read_file", 50, 0]`. Observed binding method: corpus-selected; values withheld.

Binding-selection assumption: leading parameters in projection order; an empty/NULL selector falls back to synthetic values. Selection SQL (no selected values published):

```sql
SELECT tool_name FROM search_content WHERE tool_name IS NOT NULL GROUP BY tool_name ORDER BY COUNT(*) DESC LIMIT 1
```

```text
12 / 0: SEARCH sc USING INDEX idx_search_content_tool (tool_name=?)
19 / 0: SEARCH s USING INDEX sqlite_autoindex_sessions_1 (id=?)
54 / 0: USE TEMP B-TREE FOR ORDER BY
```

Result rows: **50**. Three runs, median **259.746 ms**, range **253.553–275.425 ms**; ordered outputs stable.

### browse-tool-count

Separate exact count on every page.

```sql
SELECT COUNT(*) FROM search_content sc JOIN sessions s ON s.id = sc.session_id WHERE sc.tool_name IN (?)
```

Synthetic bindings: `["read_file"]`. Observed binding method: corpus-selected; values withheld.

Binding-selection assumption: leading parameters in projection order; an empty/NULL selector falls back to synthetic values. Selection SQL (no selected values published):

```sql
SELECT tool_name FROM search_content WHERE tool_name IS NOT NULL GROUP BY tool_name ORDER BY COUNT(*) DESC LIMIT 1
```

```text
5 / 0: SEARCH sc USING INDEX idx_search_content_tool (tool_name=?)
12 / 0: SEARCH s USING COVERING INDEX sqlite_autoindex_sessions_1 (id=?)
```

Result rows: **1**; scalar counts/totals: `[213579]`. Three runs, median **238.671 ms**, range **234.929–251.993 ms**; ordered outputs stable.

### browse-repo-page

Deep search/browse page.

```sql
SELECT sc.id, sc.session_id, sc.content_type, sc.turn_number, sc.event_index, sc.timestamp_unix, sc.tool_name, CASE WHEN LENGTH(sc.content) > 200 THEN SUBSTR(sc.content, 1, 200) || '…' ELSE sc.content END, sc.metadata_json, s.summary, s.repository, s.branch, s.updated_at, s.source FROM search_content sc JOIN sessions s ON s.id = sc.session_id WHERE s.repository IN (?) ORDER BY sc.timestamp_unix DESC NULLS LAST LIMIT ? OFFSET ?
```

Synthetic bindings: `["example/project", 50, 0]`. Observed binding method: corpus-selected; values withheld.

Binding-selection assumption: leading parameters in projection order; an empty/NULL selector falls back to synthetic values. Selection SQL (no selected values published):

```sql
SELECT repository FROM sessions WHERE repository IS NOT NULL GROUP BY repository ORDER BY COUNT(*) DESC LIMIT 1
```

```text
12 / 0: SEARCH s USING INDEX idx_sessions_repo_updated (repository=?)
19 / 0: SEARCH sc USING INDEX idx_search_content_session_event (session_id=?)
55 / 0: USE TEMP B-TREE FOR ORDER BY
```

Result rows: **50**. Three runs, median **1,143.193 ms**, range **1,113.909–1,234.337 ms**; ordered outputs stable.

### browse-repo-count

Separate exact count on every page.

```sql
SELECT COUNT(*) FROM search_content sc JOIN sessions s ON s.id = sc.session_id WHERE s.repository IN (?)
```

Synthetic bindings: `["example/project"]`. Observed binding method: corpus-selected; values withheld.

Binding-selection assumption: leading parameters in projection order; an empty/NULL selector falls back to synthetic values. Selection SQL (no selected values published):

```sql
SELECT repository FROM sessions WHERE repository IS NOT NULL GROUP BY repository ORDER BY COUNT(*) DESC LIMIT 1
```

```text
5 / 0: SEARCH s USING INDEX idx_sessions_repo_updated (repository=?)
12 / 0: SEARCH sc USING COVERING INDEX idx_search_content_session_event (session_id=?)
```

Result rows: **1**; scalar counts/totals: `[525770]`. Three runs, median **31.384 ms**, range **28.556–64.291 ms**; ordered outputs stable.

### browse-repo-facet-type

Facet cache miss; own filter omitted.

```sql
SELECT sc.content_type, COUNT(*) FROM search_content sc JOIN sessions s ON s.id = sc.session_id WHERE s.repository IN (?) GROUP BY sc.content_type ORDER BY COUNT(*) DESC
```

Synthetic bindings: `["example/project"]`. Observed binding method: corpus-selected; values withheld.

Binding-selection assumption: leading parameters in projection order; an empty/NULL selector falls back to synthetic values. Selection SQL (no selected values published):

```sql
SELECT repository FROM sessions WHERE repository IS NOT NULL GROUP BY repository ORDER BY COUNT(*) DESC LIMIT 1
```

```text
9 / 0: SEARCH s USING INDEX idx_sessions_repo_updated (repository=?)
16 / 0: SEARCH sc USING COVERING INDEX idx_search_content_session_ts_type (session_id=?)
21 / 0: USE TEMP B-TREE FOR GROUP BY
57 / 0: USE TEMP B-TREE FOR ORDER BY
```

Result rows: **10**. Three runs, median **236.736 ms**, range **235.484–241.553 ms**; ordered outputs stable.

### browse-repo-facet-repo

Facet cache miss; own filter omitted.

```sql
SELECT s.repository, COUNT(*) FROM search_content sc JOIN sessions s ON s.id = sc.session_id WHERE 1=1 AND s.repository IS NOT NULL GROUP BY s.repository ORDER BY COUNT(*) DESC LIMIT ?
```

Synthetic bindings: `[20]`. Observed binding method: synthetic.

```text
13 / 0: SEARCH s USING INDEX idx_sessions_repo_updated (repository>?)
18 / 0: SEARCH sc USING COVERING INDEX idx_search_content_session_event (session_id=?)
56 / 0: USE TEMP B-TREE FOR ORDER BY
```

Result rows: **10**. Three runs, median **87.999 ms**, range **87.243–98.598 ms**; ordered outputs stable.

### browse-repo-facet-tool

Facet cache miss; own filter omitted.

```sql
SELECT sc.tool_name, COUNT(*) FROM search_content sc JOIN sessions s ON s.id = sc.session_id WHERE s.repository IN (?) AND sc.tool_name IS NOT NULL GROUP BY sc.tool_name ORDER BY COUNT(*) DESC LIMIT ?
```

Synthetic bindings: `["example/project", 20]`. Observed binding method: corpus-selected; values withheld.

Binding-selection assumption: leading parameters in projection order; an empty/NULL selector falls back to synthetic values. Selection SQL (no selected values published):

```sql
SELECT repository FROM sessions WHERE repository IS NOT NULL GROUP BY repository ORDER BY COUNT(*) DESC LIMIT 1
```

```text
13 / 0: SEARCH s USING INDEX idx_sessions_repo_updated (repository=?)
20 / 0: SEARCH sc USING INDEX idx_search_content_session_event (session_id=?)
28 / 0: USE TEMP B-TREE FOR GROUP BY
69 / 0: USE TEMP B-TREE FOR ORDER BY
```

Result rows: **20**. Three runs, median **462.720 ms**, range **420.200–470.481 ms**; ordered outputs stable.

### browse-repo-totals

Facet exact total/distinct sessions.

```sql
SELECT COUNT(*), COUNT(DISTINCT sc.session_id) FROM search_content sc JOIN sessions s ON s.id = sc.session_id WHERE s.repository IN (?)
```

Synthetic bindings: `["example/project"]`. Observed binding method: corpus-selected; values withheld.

Binding-selection assumption: leading parameters in projection order; an empty/NULL selector falls back to synthetic values. Selection SQL (no selected values published):

```sql
SELECT repository FROM sessions WHERE repository IS NOT NULL GROUP BY repository ORDER BY COUNT(*) DESC LIMIT 1
```

```text
3 / 0: USE TEMP B-TREE FOR count(DISTINCT)
7 / 0: SEARCH s USING INDEX idx_sessions_repo_updated (repository=?)
14 / 0: SEARCH sc USING COVERING INDEX idx_search_content_session_event (session_id=?)
```

Result rows: **1**; scalar counts/totals: `[525770, 340]`. Three runs, median **110.169 ms**, range **106.485–149.642 ms**; ordered outputs stable.

### browse-session-page

Deep search/browse page.

```sql
SELECT sc.id, sc.session_id, sc.content_type, sc.turn_number, sc.event_index, sc.timestamp_unix, sc.tool_name, CASE WHEN LENGTH(sc.content) > 200 THEN SUBSTR(sc.content, 1, 200) || '…' ELSE sc.content END, sc.metadata_json, s.summary, s.repository, s.branch, s.updated_at, s.source FROM search_content sc JOIN sessions s ON s.id = sc.session_id WHERE sc.session_id = ? ORDER BY sc.timestamp_unix DESC NULLS LAST LIMIT ? OFFSET ?
```

Synthetic bindings: `["synthetic-session", 50, 0]`. Observed binding method: corpus-selected; values withheld.

Binding-selection assumption: leading parameters in projection order; an empty/NULL selector falls back to synthetic values. Selection SQL (no selected values published):

```sql
SELECT session_id FROM search_content GROUP BY session_id ORDER BY COUNT(*) DESC LIMIT 1
```

```text
12 / 0: SEARCH s USING INDEX sqlite_autoindex_sessions_1 (id=?)
18 / 0: SEARCH sc USING INDEX idx_search_content_session_ts_type (session_id=?)
```

Result rows: **50**. Three runs, median **0.347 ms**, range **0.336–0.506 ms**; ordered outputs stable.

### browse-session-count

Separate exact count on every page.

```sql
SELECT COUNT(*) FROM search_content sc JOIN sessions s ON s.id = sc.session_id WHERE sc.session_id = ?
```

Synthetic bindings: `["synthetic-session"]`. Observed binding method: corpus-selected; values withheld.

Binding-selection assumption: leading parameters in projection order; an empty/NULL selector falls back to synthetic values. Selection SQL (no selected values published):

```sql
SELECT session_id FROM search_content GROUP BY session_id ORDER BY COUNT(*) DESC LIMIT 1
```

```text
4 / 0: SEARCH s USING COVERING INDEX sqlite_autoindex_sessions_1 (id=?)
9 / 0: SEARCH sc USING COVERING INDEX idx_search_content_session_event (session_id=?)
```

Result rows: **1**; scalar counts/totals: `[22761]`. Three runs, median **1.143 ms**, range **1.069–1.339 ms**; ordered outputs stable.

### browse-session-facet-type

Facet cache miss; own filter omitted.

```sql
SELECT sc.content_type, COUNT(*) FROM search_content sc JOIN sessions s ON s.id = sc.session_id WHERE sc.session_id = ? GROUP BY sc.content_type ORDER BY COUNT(*) DESC
```

Synthetic bindings: `["synthetic-session"]`. Observed binding method: corpus-selected; values withheld.

Binding-selection assumption: leading parameters in projection order; an empty/NULL selector falls back to synthetic values. Selection SQL (no selected values published):

```sql
SELECT session_id FROM search_content GROUP BY session_id ORDER BY COUNT(*) DESC LIMIT 1
```

```text
8 / 0: SEARCH s USING COVERING INDEX sqlite_autoindex_sessions_1 (id=?)
13 / 0: SEARCH sc USING COVERING INDEX idx_search_content_session_ts_type (session_id=?)
19 / 0: USE TEMP B-TREE FOR GROUP BY
54 / 0: USE TEMP B-TREE FOR ORDER BY
```

Result rows: **8**. Three runs, median **7.528 ms**, range **7.446–9.201 ms**; ordered outputs stable.

### browse-session-facet-repo

Facet cache miss; own filter omitted.

```sql
SELECT s.repository, COUNT(*) FROM search_content sc JOIN sessions s ON s.id = sc.session_id WHERE sc.session_id = ? AND s.repository IS NOT NULL GROUP BY s.repository ORDER BY COUNT(*) DESC LIMIT ?
```

Synthetic bindings: `["synthetic-session", 20]`. Observed binding method: corpus-selected; values withheld.

Binding-selection assumption: leading parameters in projection order; an empty/NULL selector falls back to synthetic values. Selection SQL (no selected values published):

```sql
SELECT session_id FROM search_content GROUP BY session_id ORDER BY COUNT(*) DESC LIMIT 1
```

```text
12 / 0: SEARCH s USING INDEX sqlite_autoindex_sessions_1 (id=?)
20 / 0: SEARCH sc USING COVERING INDEX idx_search_content_session_event (session_id=?)
58 / 0: USE TEMP B-TREE FOR ORDER BY
```

Result rows: **1**. Three runs, median **2.323 ms**, range **2.231–2.618 ms**; ordered outputs stable.

### browse-session-facet-tool

Facet cache miss; own filter omitted.

```sql
SELECT sc.tool_name, COUNT(*) FROM search_content sc JOIN sessions s ON s.id = sc.session_id WHERE sc.session_id = ? AND sc.tool_name IS NOT NULL GROUP BY sc.tool_name ORDER BY COUNT(*) DESC LIMIT ?
```

Synthetic bindings: `["synthetic-session", 20]`. Observed binding method: corpus-selected; values withheld.

Binding-selection assumption: leading parameters in projection order; an empty/NULL selector falls back to synthetic values. Selection SQL (no selected values published):

```sql
SELECT session_id FROM search_content GROUP BY session_id ORDER BY COUNT(*) DESC LIMIT 1
```

```text
12 / 0: SEARCH s USING COVERING INDEX sqlite_autoindex_sessions_1 (id=?)
17 / 0: SEARCH sc USING INDEX idx_search_content_session_event (session_id=?)
26 / 0: USE TEMP B-TREE FOR GROUP BY
66 / 0: USE TEMP B-TREE FOR ORDER BY
```

Result rows: **18**. Three runs, median **9.604 ms**, range **8.875–18.027 ms**; ordered outputs stable.

### browse-session-totals

Facet exact total/distinct sessions.

```sql
SELECT COUNT(*), COUNT(DISTINCT sc.session_id) FROM search_content sc JOIN sessions s ON s.id = sc.session_id WHERE sc.session_id = ?
```

Synthetic bindings: `["synthetic-session"]`. Observed binding method: corpus-selected; values withheld.

Binding-selection assumption: leading parameters in projection order; an empty/NULL selector falls back to synthetic values. Selection SQL (no selected values published):

```sql
SELECT session_id FROM search_content GROUP BY session_id ORDER BY COUNT(*) DESC LIMIT 1
```

```text
3 / 0: USE TEMP B-TREE FOR count(DISTINCT)
6 / 0: SEARCH s USING COVERING INDEX sqlite_autoindex_sessions_1 (id=?)
11 / 0: SEARCH sc USING COVERING INDEX idx_search_content_session_event (session_id=?)
```

Result rows: **1**; scalar counts/totals: `[22761, 1]`. Three runs, median **2.756 ms**, range **2.638–2.856 ms**; ordered outputs stable.

### browse-source-page

Deep search/browse page.

```sql
SELECT sc.id, sc.session_id, sc.content_type, sc.turn_number, sc.event_index, sc.timestamp_unix, sc.tool_name, CASE WHEN LENGTH(sc.content) > 200 THEN SUBSTR(sc.content, 1, 200) || '…' ELSE sc.content END, sc.metadata_json, s.summary, s.repository, s.branch, s.updated_at, s.source FROM search_content sc JOIN sessions s ON s.id = sc.session_id WHERE s.source = ? ORDER BY sc.timestamp_unix DESC NULLS LAST LIMIT ? OFFSET ?
```

Synthetic bindings: `["claudeCode", 50, 0]`. Observed binding method: synthetic.

```text
12 / 0: SEARCH s USING INDEX idx_sessions_source (source=?)
19 / 0: SEARCH sc USING INDEX idx_search_content_session_event (session_id=?)
55 / 0: USE TEMP B-TREE FOR ORDER BY
```

Result rows: **50**. Three runs, median **56.064 ms**, range **55.790–56.716 ms**; ordered outputs stable.

### browse-source-count

Separate exact count on every page.

```sql
SELECT COUNT(*) FROM search_content sc JOIN sessions s ON s.id = sc.session_id WHERE s.source = ?
```

Synthetic bindings: `["claudeCode"]`. Observed binding method: synthetic.

```text
5 / 0: SEARCH s USING INDEX idx_sessions_source (source=?)
12 / 0: SEARCH sc USING COVERING INDEX idx_search_content_session_event (session_id=?)
```

Result rows: **1**; scalar counts/totals: `[73928]`. Three runs, median **3.850 ms**, range **3.595–5.584 ms**; ordered outputs stable.

### browse-source-facet-type

Facet cache miss; own filter omitted.

```sql
SELECT sc.content_type, COUNT(*) FROM search_content sc JOIN sessions s ON s.id = sc.session_id WHERE s.source = ? GROUP BY sc.content_type ORDER BY COUNT(*) DESC
```

Synthetic bindings: `["claudeCode"]`. Observed binding method: synthetic.

```text
9 / 0: SEARCH s USING INDEX idx_sessions_source (source=?)
16 / 0: SEARCH sc USING COVERING INDEX idx_search_content_session_ts_type (session_id=?)
21 / 0: USE TEMP B-TREE FOR GROUP BY
57 / 0: USE TEMP B-TREE FOR ORDER BY
```

Result rows: **10**. Three runs, median **26.716 ms**, range **26.714–31.276 ms**; ordered outputs stable.

### browse-source-facet-repo

Facet cache miss; own filter omitted.

```sql
SELECT s.repository, COUNT(*) FROM search_content sc JOIN sessions s ON s.id = sc.session_id WHERE s.source = ? AND s.repository IS NOT NULL GROUP BY s.repository ORDER BY COUNT(*) DESC LIMIT ?
```

Synthetic bindings: `["claudeCode", 20]`. Observed binding method: synthetic.

```text
12 / 0: SEARCH s USING INDEX idx_sessions_repo_updated (repository>?)
19 / 0: SEARCH sc USING COVERING INDEX idx_search_content_session_event (session_id=?)
57 / 0: USE TEMP B-TREE FOR ORDER BY
```

Result rows: **4**. Three runs, median **7.455 ms**, range **7.446–8.445 ms**; ordered outputs stable.

### browse-source-facet-tool

Facet cache miss; own filter omitted.

```sql
SELECT sc.tool_name, COUNT(*) FROM search_content sc JOIN sessions s ON s.id = sc.session_id WHERE s.source = ? AND sc.tool_name IS NOT NULL GROUP BY sc.tool_name ORDER BY COUNT(*) DESC LIMIT ?
```

Synthetic bindings: `["claudeCode", 20]`. Observed binding method: synthetic.

```text
13 / 0: SEARCH s USING INDEX idx_sessions_source (source=?)
20 / 0: SEARCH sc USING INDEX idx_search_content_session_event (session_id=?)
28 / 0: USE TEMP B-TREE FOR GROUP BY
69 / 0: USE TEMP B-TREE FOR ORDER BY
```

Result rows: **20**. Three runs, median **65.569 ms**, range **65.288–66.129 ms**; ordered outputs stable.

### browse-source-totals

Facet exact total/distinct sessions.

```sql
SELECT COUNT(*), COUNT(DISTINCT sc.session_id) FROM search_content sc JOIN sessions s ON s.id = sc.session_id WHERE s.source = ?
```

Synthetic bindings: `["claudeCode"]`. Observed binding method: synthetic.

```text
3 / 0: USE TEMP B-TREE FOR count(DISTINCT)
7 / 0: SEARCH s USING INDEX idx_sessions_source (source=?)
14 / 0: SEARCH sc USING COVERING INDEX idx_search_content_session_event (session_id=?)
```

Result rows: **1**; scalar counts/totals: `[73928, 108]`. Three runs, median **13.788 ms**, range **13.403–15.009 ms**; ordered outputs stable.

### browse-date-page

Deep search/browse page.

```sql
SELECT sc.id, sc.session_id, sc.content_type, sc.turn_number, sc.event_index, sc.timestamp_unix, sc.tool_name, CASE WHEN LENGTH(sc.content) > 200 THEN SUBSTR(sc.content, 1, 200) || '…' ELSE sc.content END, sc.metadata_json, s.summary, s.repository, s.branch, s.updated_at, s.source FROM search_content sc JOIN sessions s ON s.id = sc.session_id WHERE sc.timestamp_unix >= ? AND sc.timestamp_unix <= ? ORDER BY sc.timestamp_unix DESC NULLS LAST LIMIT ? OFFSET ?
```

Synthetic bindings: `[1767225600, 1798761599, 50, 0]`. Observed binding method: corpus-selected; values withheld.

Binding-selection assumption: leading parameters in projection order; an empty/NULL selector falls back to synthetic values. Selection SQL (no selected values published):

```sql
SELECT MIN(timestamp_unix), MAX(timestamp_unix) FROM search_content WHERE timestamp_unix IS NOT NULL
```

```text
12 / 0: SEARCH sc USING INDEX idx_search_content_timestamp (timestamp_unix>? AND timestamp_unix<?)
22 / 0: SEARCH s USING INDEX sqlite_autoindex_sessions_1 (id=?)
```

Result rows: **50**. Three runs, median **0.476 ms**, range **0.473–0.686 ms**; ordered outputs stable.

### browse-date-count

Separate exact count on every page.

```sql
SELECT COUNT(*) FROM search_content sc JOIN sessions s ON s.id = sc.session_id WHERE sc.timestamp_unix >= ? AND sc.timestamp_unix <= ?
```

Synthetic bindings: `[1767225600, 1798761599]`. Observed binding method: corpus-selected; values withheld.

Binding-selection assumption: leading parameters in projection order; an empty/NULL selector falls back to synthetic values. Selection SQL (no selected values published):

```sql
SELECT MIN(timestamp_unix), MAX(timestamp_unix) FROM search_content WHERE timestamp_unix IS NOT NULL
```

```text
4 / 0: SCAN s USING COVERING INDEX sqlite_autoindex_sessions_1
6 / 0: SEARCH sc USING COVERING INDEX idx_search_content_session_ts_type (session_id=? AND timestamp_unix>? AND timestamp_unix<?)
```

Result rows: **1**; scalar counts/totals: `[679345]`. Three runs, median **110.663 ms**, range **105.827–128.520 ms**; ordered outputs stable.

### browse-excluded-page

Deep search/browse page.

```sql
SELECT sc.id, sc.session_id, sc.content_type, sc.turn_number, sc.event_index, sc.timestamp_unix, sc.tool_name, CASE WHEN LENGTH(sc.content) > 200 THEN SUBSTR(sc.content, 1, 200) || '…' ELSE sc.content END, sc.metadata_json, s.summary, s.repository, s.branch, s.updated_at, s.source FROM search_content sc JOIN sessions s ON s.id = sc.session_id WHERE sc.content_type NOT IN (?, ?) ORDER BY sc.timestamp_unix DESC NULLS LAST LIMIT ? OFFSET ?
```

Synthetic bindings: `["tool_result", "tool_call", 50, 0]`. Observed binding method: synthetic.

```text
12 / 0: SCAN sc USING INDEX idx_search_content_timestamp
24 / 0: SEARCH s USING INDEX sqlite_autoindex_sessions_1 (id=?)
```

Result rows: **50**. Three runs, median **0.505 ms**, range **0.484–0.795 ms**; ordered outputs stable.

### browse-excluded-count

Separate exact count on every page.

```sql
SELECT COUNT(*) FROM search_content sc JOIN sessions s ON s.id = sc.session_id WHERE sc.content_type NOT IN (?, ?)
```

Synthetic bindings: `["tool_result", "tool_call"]`. Observed binding method: synthetic.

```text
4 / 0: SCAN s USING COVERING INDEX sqlite_autoindex_sessions_1
6 / 0: SEARCH sc USING COVERING INDEX idx_search_content_session_ts_type (session_id=?)
```

Result rows: **1**; scalar counts/totals: `[119564]`. Three runs, median **176.737 ms**, range **168.957–201.315 ms**; ordered outputs stable.

### browse-combined-page

Deep search/browse page.

```sql
SELECT sc.id, sc.session_id, sc.content_type, sc.turn_number, sc.event_index, sc.timestamp_unix, sc.tool_name, CASE WHEN LENGTH(sc.content) > 200 THEN SUBSTR(sc.content, 1, 200) || '…' ELSE sc.content END, sc.metadata_json, s.summary, s.repository, s.branch, s.updated_at, s.source FROM search_content sc JOIN sessions s ON s.id = sc.session_id WHERE sc.content_type IN (?) AND s.repository IN (?) AND sc.tool_name IN (?) AND s.source = ? AND sc.timestamp_unix >= ? AND sc.timestamp_unix <= ? ORDER BY sc.timestamp_unix DESC NULLS LAST LIMIT ? OFFSET ?
```

Synthetic bindings: `["tool_call", "example/project", "read_file", "copilot", 1767225600, 1798761599, 50, 0]`. Observed binding method: synthetic.

```text
12 / 0: SEARCH s USING INDEX idx_sessions_source (source=?)
21 / 0: SEARCH sc USING INDEX idx_search_content_session_ts_type (session_id=? AND timestamp_unix>? AND timestamp_unix<?)
67 / 0: USE TEMP B-TREE FOR ORDER BY
```

Result rows: **0**. Three runs, median **0.108 ms**, range **0.093–1.057 ms**; ordered outputs stable.

### browse-combined-count

Separate exact count on every page.

```sql
SELECT COUNT(*) FROM search_content sc JOIN sessions s ON s.id = sc.session_id WHERE sc.content_type IN (?) AND s.repository IN (?) AND sc.tool_name IN (?) AND s.source = ? AND sc.timestamp_unix >= ? AND sc.timestamp_unix <= ?
```

Synthetic bindings: `["tool_call", "example/project", "read_file", "copilot", 1767225600, 1798761599]`. Observed binding method: synthetic.

```text
6 / 0: SEARCH s USING INDEX idx_sessions_source (source=?)
15 / 0: SEARCH sc USING INDEX idx_search_content_session_ts_type (session_id=? AND timestamp_unix>? AND timestamp_unix<?)
```

Result rows: **1**; scalar counts/totals: `[0]`. Three runs, median **0.178 ms**, range **0.147–0.326 ms**; ordered outputs stable.

### browse-no-results-page

Deep search/browse page.

```sql
SELECT sc.id, sc.session_id, sc.content_type, sc.turn_number, sc.event_index, sc.timestamp_unix, sc.tool_name, CASE WHEN LENGTH(sc.content) > 200 THEN SUBSTR(sc.content, 1, 200) || '…' ELSE sc.content END, sc.metadata_json, s.summary, s.repository, s.branch, s.updated_at, s.source FROM search_content sc JOIN sessions s ON s.id = sc.session_id WHERE sc.session_id = ? ORDER BY sc.timestamp_unix DESC NULLS LAST LIMIT ? OFFSET ?
```

Synthetic bindings: `["synthetic-nonexistent-session", 50, 0]`. Observed binding method: synthetic.

```text
12 / 0: SEARCH s USING INDEX sqlite_autoindex_sessions_1 (id=?)
18 / 0: SEARCH sc USING INDEX idx_search_content_session_ts_type (session_id=?)
```

Result rows: **0**. Three runs, median **0.010 ms**, range **0.009–0.027 ms**; ordered outputs stable.

### browse-no-results-count

Separate exact count on every page.

```sql
SELECT COUNT(*) FROM search_content sc JOIN sessions s ON s.id = sc.session_id WHERE sc.session_id = ?
```

Synthetic bindings: `["synthetic-nonexistent-session"]`. Observed binding method: synthetic.

```text
4 / 0: SEARCH s USING COVERING INDEX sqlite_autoindex_sessions_1 (id=?)
9 / 0: SEARCH sc USING COVERING INDEX idx_search_content_session_event (session_id=?)
```

Result rows: **1**; scalar counts/totals: `[0]`. Three runs, median **0.008 ms**, range **0.006–0.037 ms**; ordered outputs stable.

### fts-common-page

Deep search/browse page.

```sql
SELECT sc.id, sc.session_id, sc.content_type, sc.turn_number, sc.event_index, sc.timestamp_unix, sc.tool_name, snippet(search_fts, 0, '\x01MARK_OPEN\x01', '\x01MARK_CLOSE\x01', '…', 48), sc.metadata_json, s.summary, s.repository, s.branch, s.updated_at, s.source FROM search_fts JOIN search_content sc ON sc.id = search_fts.rowid JOIN sessions s ON s.id = sc.session_id WHERE search_fts MATCH ? ORDER BY CASE sc.content_type WHEN 'user_message' THEN rank * 2.0 WHEN 'error' THEN rank * 2.0 WHEN 'tool_error' THEN rank * 1.8 WHEN 'assistant_message' THEN rank * 1.5 WHEN 'reasoning' THEN rank * 1.3 WHEN 'compaction_summary' THEN rank * 1.1 WHEN 'subagent' THEN rank * 1.1 WHEN 'system_message' THEN rank * 1.0 WHEN 'tool_call' THEN rank * 0.6 WHEN 'tool_result' THEN rank * 0.7 ELSE rank END LIMIT ? OFFSET ?
```

Synthetic bindings: `["error", 50, 0]`. Observed binding method: synthetic.

```text
12 / 0: SCAN search_fts VIRTUAL TABLE INDEX 0:M1
17 / 0: SEARCH sc USING INTEGER PRIMARY KEY (rowid=?)
20 / 0: SEARCH s USING INDEX sqlite_autoindex_sessions_1 (id=?)
91 / 0: USE TEMP B-TREE FOR ORDER BY
```

Result rows: **50**. Three runs, median **190.702 ms**, range **169.147–192.573 ms**; ordered outputs stable.

### fts-common-count

Separate exact count on every page.

```sql
SELECT COUNT(*) FROM search_fts JOIN search_content sc ON sc.id = search_fts.rowid JOIN sessions s ON s.id = sc.session_id WHERE search_fts MATCH ?
```

Synthetic bindings: `["error"]`. Observed binding method: synthetic.

```text
5 / 0: SCAN search_fts VIRTUAL TABLE INDEX 0:M1
10 / 0: SEARCH sc USING INTEGER PRIMARY KEY (rowid=?)
13 / 0: SEARCH s USING COVERING INDEX sqlite_autoindex_sessions_1 (id=?)
```

Result rows: **1**; scalar counts/totals: `[34375]`. Three runs, median **110.237 ms**, range **101.602–124.384 ms**; ordered outputs stable.

### fts-common-facet-type

Facet cache miss; own filter omitted.

```sql
SELECT sc.content_type, COUNT(*) FROM search_fts JOIN search_content sc ON sc.id = search_fts.rowid JOIN sessions s ON s.id = sc.session_id WHERE search_fts MATCH ? GROUP BY sc.content_type ORDER BY COUNT(*) DESC
```

Synthetic bindings: `["error"]`. Observed binding method: synthetic.

```text
9 / 0: SCAN search_fts VIRTUAL TABLE INDEX 0:M1
14 / 0: SEARCH sc USING INTEGER PRIMARY KEY (rowid=?)
17 / 0: SEARCH s USING COVERING INDEX sqlite_autoindex_sessions_1 (id=?)
21 / 0: USE TEMP B-TREE FOR GROUP BY
57 / 0: USE TEMP B-TREE FOR ORDER BY
```

Result rows: **9**. Three runs, median **122.376 ms**, range **113.478–124.070 ms**; ordered outputs stable.

### fts-common-facet-repo

Facet cache miss; own filter omitted.

```sql
SELECT s.repository, COUNT(*) FROM search_fts JOIN search_content sc ON sc.id = search_fts.rowid JOIN sessions s ON s.id = sc.session_id WHERE search_fts MATCH ? AND s.repository IS NOT NULL GROUP BY s.repository ORDER BY COUNT(*) DESC LIMIT ?
```

Synthetic bindings: `["error", 20]`. Observed binding method: synthetic.

```text
13 / 0: SCAN search_fts VIRTUAL TABLE INDEX 0:M1
18 / 0: SEARCH sc USING INTEGER PRIMARY KEY (rowid=?)
21 / 0: SEARCH s USING INDEX sqlite_autoindex_sessions_1 (id=?)
28 / 0: USE TEMP B-TREE FOR GROUP BY
69 / 0: USE TEMP B-TREE FOR ORDER BY
```

Result rows: **10**. Three runs, median **113.639 ms**, range **112.503–120.391 ms**; ordered outputs stable.

### fts-common-facet-tool

Facet cache miss; own filter omitted.

```sql
SELECT sc.tool_name, COUNT(*) FROM search_fts JOIN search_content sc ON sc.id = search_fts.rowid JOIN sessions s ON s.id = sc.session_id WHERE search_fts MATCH ? AND sc.tool_name IS NOT NULL GROUP BY sc.tool_name ORDER BY COUNT(*) DESC LIMIT ?
```

Synthetic bindings: `["error", 20]`. Observed binding method: synthetic.

```text
12 / 0: SCAN search_fts VIRTUAL TABLE INDEX 0:M1
17 / 0: SEARCH sc USING INTEGER PRIMARY KEY (rowid=?)
22 / 0: SEARCH s USING COVERING INDEX sqlite_autoindex_sessions_1 (id=?)
26 / 0: USE TEMP B-TREE FOR GROUP BY
67 / 0: USE TEMP B-TREE FOR ORDER BY
```

Result rows: **20**. Three runs, median **108.302 ms**, range **107.053–109.097 ms**; ordered outputs stable.

### fts-common-totals

Facet exact total/distinct sessions.

```sql
SELECT COUNT(*), COUNT(DISTINCT sc.session_id) FROM search_fts JOIN search_content sc ON sc.id = search_fts.rowid JOIN sessions s ON s.id = sc.session_id WHERE search_fts MATCH ?
```

Synthetic bindings: `["error"]`. Observed binding method: synthetic.

```text
3 / 0: USE TEMP B-TREE FOR count(DISTINCT)
7 / 0: SCAN search_fts VIRTUAL TABLE INDEX 0:M1
12 / 0: SEARCH sc USING INTEGER PRIMARY KEY (rowid=?)
15 / 0: SEARCH s USING COVERING INDEX sqlite_autoindex_sessions_1 (id=?)
```

Result rows: **1**; scalar counts/totals: `[34375, 397]`. Three runs, median **109.094 ms**, range **106.990–122.158 ms**; ordered outputs stable.

### fts-selective-page

Deep search/browse page.

```sql
SELECT sc.id, sc.session_id, sc.content_type, sc.turn_number, sc.event_index, sc.timestamp_unix, sc.tool_name, snippet(search_fts, 0, '\x01MARK_OPEN\x01', '\x01MARK_CLOSE\x01', '…', 48), sc.metadata_json, s.summary, s.repository, s.branch, s.updated_at, s.source FROM search_fts JOIN search_content sc ON sc.id = search_fts.rowid JOIN sessions s ON s.id = sc.session_id WHERE search_fts MATCH ? ORDER BY CASE sc.content_type WHEN 'user_message' THEN rank * 2.0 WHEN 'error' THEN rank * 2.0 WHEN 'tool_error' THEN rank * 1.8 WHEN 'assistant_message' THEN rank * 1.5 WHEN 'reasoning' THEN rank * 1.3 WHEN 'compaction_summary' THEN rank * 1.1 WHEN 'subagent' THEN rank * 1.1 WHEN 'system_message' THEN rank * 1.0 WHEN 'tool_call' THEN rank * 0.6 WHEN 'tool_result' THEN rank * 0.7 ELSE rank END LIMIT ? OFFSET ?
```

Synthetic bindings: `["\"database migration\"", 50, 0]`. Observed binding method: synthetic.

```text
12 / 0: SCAN search_fts VIRTUAL TABLE INDEX 0:M1
17 / 0: SEARCH sc USING INTEGER PRIMARY KEY (rowid=?)
20 / 0: SEARCH s USING INDEX sqlite_autoindex_sessions_1 (id=?)
91 / 0: USE TEMP B-TREE FOR ORDER BY
```

Result rows: **50**. Three runs, median **3.208 ms**, range **2.926–5.063 ms**; ordered outputs stable.

### fts-selective-count

Separate exact count on every page.

```sql
SELECT COUNT(*) FROM search_fts JOIN search_content sc ON sc.id = search_fts.rowid JOIN sessions s ON s.id = sc.session_id WHERE search_fts MATCH ?
```

Synthetic bindings: `["\"database migration\""]`. Observed binding method: synthetic.

```text
5 / 0: SCAN search_fts VIRTUAL TABLE INDEX 0:M1
10 / 0: SEARCH sc USING INTEGER PRIMARY KEY (rowid=?)
13 / 0: SEARCH s USING COVERING INDEX sqlite_autoindex_sessions_1 (id=?)
```

Result rows: **1**; scalar counts/totals: `[113]`. Three runs, median **0.528 ms**, range **0.521–0.658 ms**; ordered outputs stable.

### fts-selective-facet-type

Facet cache miss; own filter omitted.

```sql
SELECT sc.content_type, COUNT(*) FROM search_fts JOIN search_content sc ON sc.id = search_fts.rowid JOIN sessions s ON s.id = sc.session_id WHERE search_fts MATCH ? GROUP BY sc.content_type ORDER BY COUNT(*) DESC
```

Synthetic bindings: `["\"database migration\""]`. Observed binding method: synthetic.

```text
9 / 0: SCAN search_fts VIRTUAL TABLE INDEX 0:M1
14 / 0: SEARCH sc USING INTEGER PRIMARY KEY (rowid=?)
17 / 0: SEARCH s USING COVERING INDEX sqlite_autoindex_sessions_1 (id=?)
21 / 0: USE TEMP B-TREE FOR GROUP BY
57 / 0: USE TEMP B-TREE FOR ORDER BY
```

Result rows: **5**. Three runs, median **0.468 ms**, range **0.458–0.495 ms**; ordered outputs stable.

### fts-selective-facet-repo

Facet cache miss; own filter omitted.

```sql
SELECT s.repository, COUNT(*) FROM search_fts JOIN search_content sc ON sc.id = search_fts.rowid JOIN sessions s ON s.id = sc.session_id WHERE search_fts MATCH ? AND s.repository IS NOT NULL GROUP BY s.repository ORDER BY COUNT(*) DESC LIMIT ?
```

Synthetic bindings: `["\"database migration\"", 20]`. Observed binding method: synthetic.

```text
13 / 0: SCAN search_fts VIRTUAL TABLE INDEX 0:M1
18 / 0: SEARCH sc USING INTEGER PRIMARY KEY (rowid=?)
21 / 0: SEARCH s USING INDEX sqlite_autoindex_sessions_1 (id=?)
28 / 0: USE TEMP B-TREE FOR GROUP BY
69 / 0: USE TEMP B-TREE FOR ORDER BY
```

Result rows: **2**. Three runs, median **0.482 ms**, range **0.474–0.620 ms**; ordered outputs stable.

### fts-selective-facet-tool

Facet cache miss; own filter omitted.

```sql
SELECT sc.tool_name, COUNT(*) FROM search_fts JOIN search_content sc ON sc.id = search_fts.rowid JOIN sessions s ON s.id = sc.session_id WHERE search_fts MATCH ? AND sc.tool_name IS NOT NULL GROUP BY sc.tool_name ORDER BY COUNT(*) DESC LIMIT ?
```

Synthetic bindings: `["\"database migration\"", 20]`. Observed binding method: synthetic.

```text
12 / 0: SCAN search_fts VIRTUAL TABLE INDEX 0:M1
17 / 0: SEARCH sc USING INTEGER PRIMARY KEY (rowid=?)
22 / 0: SEARCH s USING COVERING INDEX sqlite_autoindex_sessions_1 (id=?)
26 / 0: USE TEMP B-TREE FOR GROUP BY
67 / 0: USE TEMP B-TREE FOR ORDER BY
```

Result rows: **10**. Three runs, median **0.468 ms**, range **0.443–0.524 ms**; ordered outputs stable.

### fts-selective-totals

Facet exact total/distinct sessions.

```sql
SELECT COUNT(*), COUNT(DISTINCT sc.session_id) FROM search_fts JOIN search_content sc ON sc.id = search_fts.rowid JOIN sessions s ON s.id = sc.session_id WHERE search_fts MATCH ?
```

Synthetic bindings: `["\"database migration\""]`. Observed binding method: synthetic.

```text
3 / 0: USE TEMP B-TREE FOR count(DISTINCT)
7 / 0: SCAN search_fts VIRTUAL TABLE INDEX 0:M1
12 / 0: SEARCH sc USING INTEGER PRIMARY KEY (rowid=?)
15 / 0: SEARCH s USING COVERING INDEX sqlite_autoindex_sessions_1 (id=?)
```

Result rows: **1**; scalar counts/totals: `[113, 52]`. Three runs, median **0.454 ms**, range **0.450–0.622 ms**; ordered outputs stable.

### fts-no-results-page

Deep search/browse page.

```sql
SELECT sc.id, sc.session_id, sc.content_type, sc.turn_number, sc.event_index, sc.timestamp_unix, sc.tool_name, snippet(search_fts, 0, '\x01MARK_OPEN\x01', '\x01MARK_CLOSE\x01', '…', 48), sc.metadata_json, s.summary, s.repository, s.branch, s.updated_at, s.source FROM search_fts JOIN search_content sc ON sc.id = search_fts.rowid JOIN sessions s ON s.id = sc.session_id WHERE search_fts MATCH ? ORDER BY CASE sc.content_type WHEN 'user_message' THEN rank * 2.0 WHEN 'error' THEN rank * 2.0 WHEN 'tool_error' THEN rank * 1.8 WHEN 'assistant_message' THEN rank * 1.5 WHEN 'reasoning' THEN rank * 1.3 WHEN 'compaction_summary' THEN rank * 1.1 WHEN 'subagent' THEN rank * 1.1 WHEN 'system_message' THEN rank * 1.0 WHEN 'tool_call' THEN rank * 0.6 WHEN 'tool_result' THEN rank * 0.7 ELSE rank END LIMIT ? OFFSET ?
```

Synthetic bindings: `["zzzxqsyntheticmissingterm", 50, 0]`. Observed binding method: synthetic.

```text
12 / 0: SCAN search_fts VIRTUAL TABLE INDEX 0:M1
17 / 0: SEARCH sc USING INTEGER PRIMARY KEY (rowid=?)
20 / 0: SEARCH s USING INDEX sqlite_autoindex_sessions_1 (id=?)
91 / 0: USE TEMP B-TREE FOR ORDER BY
```

Result rows: **0**. Three runs, median **0.030 ms**, range **0.024–0.288 ms**; ordered outputs stable.

### fts-no-results-count

Separate exact count on every page.

```sql
SELECT COUNT(*) FROM search_fts JOIN search_content sc ON sc.id = search_fts.rowid JOIN sessions s ON s.id = sc.session_id WHERE search_fts MATCH ?
```

Synthetic bindings: `["zzzxqsyntheticmissingterm"]`. Observed binding method: synthetic.

```text
5 / 0: SCAN search_fts VIRTUAL TABLE INDEX 0:M1
10 / 0: SEARCH sc USING INTEGER PRIMARY KEY (rowid=?)
13 / 0: SEARCH s USING COVERING INDEX sqlite_autoindex_sessions_1 (id=?)
```

Result rows: **1**; scalar counts/totals: `[0]`. Three runs, median **0.034 ms**, range **0.029–0.057 ms**; ordered outputs stable.

### fts-no-results-facet-type

Facet cache miss; own filter omitted.

```sql
SELECT sc.content_type, COUNT(*) FROM search_fts JOIN search_content sc ON sc.id = search_fts.rowid JOIN sessions s ON s.id = sc.session_id WHERE search_fts MATCH ? GROUP BY sc.content_type ORDER BY COUNT(*) DESC
```

Synthetic bindings: `["zzzxqsyntheticmissingterm"]`. Observed binding method: synthetic.

```text
9 / 0: SCAN search_fts VIRTUAL TABLE INDEX 0:M1
14 / 0: SEARCH sc USING INTEGER PRIMARY KEY (rowid=?)
17 / 0: SEARCH s USING COVERING INDEX sqlite_autoindex_sessions_1 (id=?)
21 / 0: USE TEMP B-TREE FOR GROUP BY
57 / 0: USE TEMP B-TREE FOR ORDER BY
```

Result rows: **0**. Three runs, median **0.029 ms**, range **0.026–0.047 ms**; ordered outputs stable.

### fts-no-results-facet-repo

Facet cache miss; own filter omitted.

```sql
SELECT s.repository, COUNT(*) FROM search_fts JOIN search_content sc ON sc.id = search_fts.rowid JOIN sessions s ON s.id = sc.session_id WHERE search_fts MATCH ? AND s.repository IS NOT NULL GROUP BY s.repository ORDER BY COUNT(*) DESC LIMIT ?
```

Synthetic bindings: `["zzzxqsyntheticmissingterm", 20]`. Observed binding method: synthetic.

```text
13 / 0: SCAN search_fts VIRTUAL TABLE INDEX 0:M1
18 / 0: SEARCH sc USING INTEGER PRIMARY KEY (rowid=?)
21 / 0: SEARCH s USING INDEX sqlite_autoindex_sessions_1 (id=?)
28 / 0: USE TEMP B-TREE FOR GROUP BY
69 / 0: USE TEMP B-TREE FOR ORDER BY
```

Result rows: **0**. Three runs, median **0.040 ms**, range **0.033–0.062 ms**; ordered outputs stable.

### fts-no-results-facet-tool

Facet cache miss; own filter omitted.

```sql
SELECT sc.tool_name, COUNT(*) FROM search_fts JOIN search_content sc ON sc.id = search_fts.rowid JOIN sessions s ON s.id = sc.session_id WHERE search_fts MATCH ? AND sc.tool_name IS NOT NULL GROUP BY sc.tool_name ORDER BY COUNT(*) DESC LIMIT ?
```

Synthetic bindings: `["zzzxqsyntheticmissingterm", 20]`. Observed binding method: synthetic.

```text
12 / 0: SCAN search_fts VIRTUAL TABLE INDEX 0:M1
17 / 0: SEARCH sc USING INTEGER PRIMARY KEY (rowid=?)
22 / 0: SEARCH s USING COVERING INDEX sqlite_autoindex_sessions_1 (id=?)
26 / 0: USE TEMP B-TREE FOR GROUP BY
67 / 0: USE TEMP B-TREE FOR ORDER BY
```

Result rows: **0**. Three runs, median **0.041 ms**, range **0.036–0.059 ms**; ordered outputs stable.

### fts-no-results-totals

Facet exact total/distinct sessions.

```sql
SELECT COUNT(*), COUNT(DISTINCT sc.session_id) FROM search_fts JOIN search_content sc ON sc.id = search_fts.rowid JOIN sessions s ON s.id = sc.session_id WHERE search_fts MATCH ?
```

Synthetic bindings: `["zzzxqsyntheticmissingterm"]`. Observed binding method: synthetic.

```text
3 / 0: USE TEMP B-TREE FOR count(DISTINCT)
7 / 0: SCAN search_fts VIRTUAL TABLE INDEX 0:M1
12 / 0: SEARCH sc USING INTEGER PRIMARY KEY (rowid=?)
15 / 0: SEARCH s USING COVERING INDEX sqlite_autoindex_sessions_1 (id=?)
```

Result rows: **1**; scalar counts/totals: `[0, 0]`. Three runs, median **0.062 ms**, range **0.055–0.113 ms**; ordered outputs stable.

### fts-prefix-page

Deep search/browse page.

```sql
SELECT sc.id, sc.session_id, sc.content_type, sc.turn_number, sc.event_index, sc.timestamp_unix, sc.tool_name, snippet(search_fts, 0, '\x01MARK_OPEN\x01', '\x01MARK_CLOSE\x01', '…', 48), sc.metadata_json, s.summary, s.repository, s.branch, s.updated_at, s.source FROM search_fts JOIN search_content sc ON sc.id = search_fts.rowid JOIN sessions s ON s.id = sc.session_id WHERE search_fts MATCH ? ORDER BY CASE sc.content_type WHEN 'user_message' THEN rank * 2.0 WHEN 'error' THEN rank * 2.0 WHEN 'tool_error' THEN rank * 1.8 WHEN 'assistant_message' THEN rank * 1.5 WHEN 'reasoning' THEN rank * 1.3 WHEN 'compaction_summary' THEN rank * 1.1 WHEN 'subagent' THEN rank * 1.1 WHEN 'system_message' THEN rank * 1.0 WHEN 'tool_call' THEN rank * 0.6 WHEN 'tool_result' THEN rank * 0.7 ELSE rank END LIMIT ? OFFSET ?
```

Synthetic bindings: `["a*", 50, 0]`. Observed binding method: synthetic.

```text
12 / 0: SCAN search_fts VIRTUAL TABLE INDEX 0:M1
17 / 0: SEARCH sc USING INTEGER PRIMARY KEY (rowid=?)
20 / 0: SEARCH s USING INDEX sqlite_autoindex_sessions_1 (id=?)
91 / 0: USE TEMP B-TREE FOR ORDER BY
```

Result rows: **50**. Three runs, median **1,434.753 ms**, range **1,434.464–1,439.734 ms**; ordered outputs stable.

### fts-prefix-count

Separate exact count on every page.

```sql
SELECT COUNT(*) FROM search_fts JOIN search_content sc ON sc.id = search_fts.rowid JOIN sessions s ON s.id = sc.session_id WHERE search_fts MATCH ?
```

Synthetic bindings: `["a*"]`. Observed binding method: synthetic.

```text
5 / 0: SCAN search_fts VIRTUAL TABLE INDEX 0:M1
10 / 0: SEARCH sc USING INTEGER PRIMARY KEY (rowid=?)
13 / 0: SEARCH s USING COVERING INDEX sqlite_autoindex_sessions_1 (id=?)
```

Result rows: **1**; scalar counts/totals: `[438182]`. Three runs, median **619.893 ms**, range **609.372–649.186 ms**; ordered outputs stable.

### fts-prefix-facet-type

Facet cache miss; own filter omitted.

```sql
SELECT sc.content_type, COUNT(*) FROM search_fts JOIN search_content sc ON sc.id = search_fts.rowid JOIN sessions s ON s.id = sc.session_id WHERE search_fts MATCH ? GROUP BY sc.content_type ORDER BY COUNT(*) DESC
```

Synthetic bindings: `["a*"]`. Observed binding method: synthetic.

```text
9 / 0: SCAN search_fts VIRTUAL TABLE INDEX 0:M1
14 / 0: SEARCH sc USING INTEGER PRIMARY KEY (rowid=?)
17 / 0: SEARCH s USING COVERING INDEX sqlite_autoindex_sessions_1 (id=?)
21 / 0: USE TEMP B-TREE FOR GROUP BY
57 / 0: USE TEMP B-TREE FOR ORDER BY
```

Result rows: **10**. Three runs, median **789.514 ms**, range **783.854–820.362 ms**; ordered outputs stable.

### fts-prefix-facet-repo

Facet cache miss; own filter omitted.

```sql
SELECT s.repository, COUNT(*) FROM search_fts JOIN search_content sc ON sc.id = search_fts.rowid JOIN sessions s ON s.id = sc.session_id WHERE search_fts MATCH ? AND s.repository IS NOT NULL GROUP BY s.repository ORDER BY COUNT(*) DESC LIMIT ?
```

Synthetic bindings: `["a*", 20]`. Observed binding method: synthetic.

```text
13 / 0: SCAN search_fts VIRTUAL TABLE INDEX 0:M1
18 / 0: SEARCH sc USING INTEGER PRIMARY KEY (rowid=?)
21 / 0: SEARCH s USING INDEX sqlite_autoindex_sessions_1 (id=?)
28 / 0: USE TEMP B-TREE FOR GROUP BY
69 / 0: USE TEMP B-TREE FOR ORDER BY
```

Result rows: **10**. Three runs, median **778.799 ms**, range **776.555–822.073 ms**; ordered outputs stable.

### fts-prefix-facet-tool

Facet cache miss; own filter omitted.

```sql
SELECT sc.tool_name, COUNT(*) FROM search_fts JOIN search_content sc ON sc.id = search_fts.rowid JOIN sessions s ON s.id = sc.session_id WHERE search_fts MATCH ? AND sc.tool_name IS NOT NULL GROUP BY sc.tool_name ORDER BY COUNT(*) DESC LIMIT ?
```

Synthetic bindings: `["a*", 20]`. Observed binding method: synthetic.

```text
12 / 0: SCAN search_fts VIRTUAL TABLE INDEX 0:M1
17 / 0: SEARCH sc USING INTEGER PRIMARY KEY (rowid=?)
22 / 0: SEARCH s USING COVERING INDEX sqlite_autoindex_sessions_1 (id=?)
26 / 0: USE TEMP B-TREE FOR GROUP BY
67 / 0: USE TEMP B-TREE FOR ORDER BY
```

Result rows: **20**. Three runs, median **724.604 ms**, range **717.392–736.877 ms**; ordered outputs stable.

### fts-prefix-totals

Facet exact total/distinct sessions.

```sql
SELECT COUNT(*), COUNT(DISTINCT sc.session_id) FROM search_fts JOIN search_content sc ON sc.id = search_fts.rowid JOIN sessions s ON s.id = sc.session_id WHERE search_fts MATCH ?
```

Synthetic bindings: `["a*"]`. Observed binding method: synthetic.

```text
3 / 0: USE TEMP B-TREE FOR count(DISTINCT)
7 / 0: SCAN search_fts VIRTUAL TABLE INDEX 0:M1
12 / 0: SEARCH sc USING INTEGER PRIMARY KEY (rowid=?)
15 / 0: SEARCH s USING COVERING INDEX sqlite_autoindex_sessions_1 (id=?)
```

Result rows: **1**; scalar counts/totals: `[438182, 492]`. Three runs, median **659.691 ms**, range **649.041–674.979 ms**; ordered outputs stable.

### fts-repo-page

Deep search/browse page.

```sql
SELECT sc.id, sc.session_id, sc.content_type, sc.turn_number, sc.event_index, sc.timestamp_unix, sc.tool_name, snippet(search_fts, 0, '\x01MARK_OPEN\x01', '\x01MARK_CLOSE\x01', '…', 48), sc.metadata_json, s.summary, s.repository, s.branch, s.updated_at, s.source FROM search_fts JOIN search_content sc ON sc.id = search_fts.rowid JOIN sessions s ON s.id = sc.session_id WHERE search_fts MATCH ? AND s.repository IN (?) ORDER BY CASE sc.content_type WHEN 'user_message' THEN rank * 2.0 WHEN 'error' THEN rank * 2.0 WHEN 'tool_error' THEN rank * 1.8 WHEN 'assistant_message' THEN rank * 1.5 WHEN 'reasoning' THEN rank * 1.3 WHEN 'compaction_summary' THEN rank * 1.1 WHEN 'subagent' THEN rank * 1.1 WHEN 'system_message' THEN rank * 1.0 WHEN 'tool_call' THEN rank * 0.6 WHEN 'tool_result' THEN rank * 0.7 ELSE rank END LIMIT ? OFFSET ?
```

Synthetic bindings: `["error", "example/project", 50, 0]`. Observed binding method: corpus-selected; values withheld.

Binding-selection assumption: zero-based parameter positions [1]; an empty/NULL selector falls back to synthetic values. Selection SQL (no selected values published):

```sql
SELECT repository FROM sessions WHERE repository IS NOT NULL GROUP BY repository ORDER BY COUNT(*) DESC LIMIT 1
```

```text
12 / 0: SCAN search_fts VIRTUAL TABLE INDEX 0:M1
17 / 0: SEARCH sc USING INTEGER PRIMARY KEY (rowid=?)
20 / 0: SEARCH s USING INDEX sqlite_autoindex_sessions_1 (id=?)
93 / 0: USE TEMP B-TREE FOR ORDER BY
```

Result rows: **50**. Three runs, median **165.217 ms**, range **164.630–167.693 ms**; ordered outputs stable.

### fts-repo-count

Separate exact count on every page.

```sql
SELECT COUNT(*) FROM search_fts JOIN search_content sc ON sc.id = search_fts.rowid JOIN sessions s ON s.id = sc.session_id WHERE search_fts MATCH ? AND s.repository IN (?)
```

Synthetic bindings: `["error", "example/project"]`. Observed binding method: corpus-selected; values withheld.

Binding-selection assumption: zero-based parameter positions [1]; an empty/NULL selector falls back to synthetic values. Selection SQL (no selected values published):

```sql
SELECT repository FROM sessions WHERE repository IS NOT NULL GROUP BY repository ORDER BY COUNT(*) DESC LIMIT 1
```

```text
6 / 0: SCAN search_fts VIRTUAL TABLE INDEX 0:M1
11 / 0: SEARCH sc USING INTEGER PRIMARY KEY (rowid=?)
14 / 0: SEARCH s USING INDEX sqlite_autoindex_sessions_1 (id=?)
```

Result rows: **1**; scalar counts/totals: `[29407]`. Three runs, median **108.548 ms**, range **106.788–110.056 ms**; ordered outputs stable.

### fts-repo-facet-type

Facet cache miss; own filter omitted.

```sql
SELECT sc.content_type, COUNT(*) FROM search_fts JOIN search_content sc ON sc.id = search_fts.rowid JOIN sessions s ON s.id = sc.session_id WHERE search_fts MATCH ? AND s.repository IN (?) GROUP BY sc.content_type ORDER BY COUNT(*) DESC
```

Synthetic bindings: `["error", "example/project"]`. Observed binding method: corpus-selected; values withheld.

Binding-selection assumption: zero-based parameter positions [1]; an empty/NULL selector falls back to synthetic values. Selection SQL (no selected values published):

```sql
SELECT repository FROM sessions WHERE repository IS NOT NULL GROUP BY repository ORDER BY COUNT(*) DESC LIMIT 1
```

```text
10 / 0: SCAN search_fts VIRTUAL TABLE INDEX 0:M1
15 / 0: SEARCH sc USING INTEGER PRIMARY KEY (rowid=?)
18 / 0: SEARCH s USING INDEX sqlite_autoindex_sessions_1 (id=?)
25 / 0: USE TEMP B-TREE FOR GROUP BY
61 / 0: USE TEMP B-TREE FOR ORDER BY
```

Result rows: **9**. Three runs, median **123.546 ms**, range **121.927–128.845 ms**; ordered outputs stable.

### fts-repo-facet-repo

Facet cache miss; own filter omitted.

```sql
SELECT s.repository, COUNT(*) FROM search_fts JOIN search_content sc ON sc.id = search_fts.rowid JOIN sessions s ON s.id = sc.session_id WHERE search_fts MATCH ? AND s.repository IS NOT NULL GROUP BY s.repository ORDER BY COUNT(*) DESC LIMIT ?
```

Synthetic bindings: `["error", 20]`. Observed binding method: synthetic.

```text
13 / 0: SCAN search_fts VIRTUAL TABLE INDEX 0:M1
18 / 0: SEARCH sc USING INTEGER PRIMARY KEY (rowid=?)
21 / 0: SEARCH s USING INDEX sqlite_autoindex_sessions_1 (id=?)
28 / 0: USE TEMP B-TREE FOR GROUP BY
69 / 0: USE TEMP B-TREE FOR ORDER BY
```

Result rows: **10**. Three runs, median **116.467 ms**, range **114.613–122.374 ms**; ordered outputs stable.

### fts-repo-facet-tool

Facet cache miss; own filter omitted.

```sql
SELECT sc.tool_name, COUNT(*) FROM search_fts JOIN search_content sc ON sc.id = search_fts.rowid JOIN sessions s ON s.id = sc.session_id WHERE search_fts MATCH ? AND s.repository IN (?) AND sc.tool_name IS NOT NULL GROUP BY sc.tool_name ORDER BY COUNT(*) DESC LIMIT ?
```

Synthetic bindings: `["error", "example/project", 20]`. Observed binding method: corpus-selected; values withheld.

Binding-selection assumption: zero-based parameter positions [1]; an empty/NULL selector falls back to synthetic values. Selection SQL (no selected values published):

```sql
SELECT repository FROM sessions WHERE repository IS NOT NULL GROUP BY repository ORDER BY COUNT(*) DESC LIMIT 1
```

```text
13 / 0: SCAN search_fts VIRTUAL TABLE INDEX 0:M1
18 / 0: SEARCH sc USING INTEGER PRIMARY KEY (rowid=?)
23 / 0: SEARCH s USING INDEX sqlite_autoindex_sessions_1 (id=?)
30 / 0: USE TEMP B-TREE FOR GROUP BY
71 / 0: USE TEMP B-TREE FOR ORDER BY
```

Result rows: **20**. Three runs, median **117.818 ms**, range **114.009–125.243 ms**; ordered outputs stable.

### fts-repo-totals

Facet exact total/distinct sessions.

```sql
SELECT COUNT(*), COUNT(DISTINCT sc.session_id) FROM search_fts JOIN search_content sc ON sc.id = search_fts.rowid JOIN sessions s ON s.id = sc.session_id WHERE search_fts MATCH ? AND s.repository IN (?)
```

Synthetic bindings: `["error", "example/project"]`. Observed binding method: corpus-selected; values withheld.

Binding-selection assumption: zero-based parameter positions [1]; an empty/NULL selector falls back to synthetic values. Selection SQL (no selected values published):

```sql
SELECT repository FROM sessions WHERE repository IS NOT NULL GROUP BY repository ORDER BY COUNT(*) DESC LIMIT 1
```

```text
3 / 0: USE TEMP B-TREE FOR count(DISTINCT)
8 / 0: SCAN search_fts VIRTUAL TABLE INDEX 0:M1
13 / 0: SEARCH sc USING INTEGER PRIMARY KEY (rowid=?)
16 / 0: SEARCH s USING INDEX sqlite_autoindex_sessions_1 (id=?)
```

Result rows: **1**; scalar counts/totals: `[29407, 284]`. Three runs, median **141.426 ms**, range **117.854–190.805 ms**; ordered outputs stable.

### fts-session-page

Deep search/browse page.

```sql
SELECT sc.id, sc.session_id, sc.content_type, sc.turn_number, sc.event_index, sc.timestamp_unix, sc.tool_name, snippet(search_fts, 0, '\x01MARK_OPEN\x01', '\x01MARK_CLOSE\x01', '…', 48), sc.metadata_json, s.summary, s.repository, s.branch, s.updated_at, s.source FROM search_fts JOIN search_content sc ON sc.id = search_fts.rowid JOIN sessions s ON s.id = sc.session_id WHERE search_fts MATCH ? AND sc.session_id = ? ORDER BY CASE sc.content_type WHEN 'user_message' THEN rank * 2.0 WHEN 'error' THEN rank * 2.0 WHEN 'tool_error' THEN rank * 1.8 WHEN 'assistant_message' THEN rank * 1.5 WHEN 'reasoning' THEN rank * 1.3 WHEN 'compaction_summary' THEN rank * 1.1 WHEN 'subagent' THEN rank * 1.1 WHEN 'system_message' THEN rank * 1.0 WHEN 'tool_call' THEN rank * 0.6 WHEN 'tool_result' THEN rank * 0.7 ELSE rank END LIMIT ? OFFSET ?
```

Synthetic bindings: `["error", "synthetic-session", 50, 0]`. Observed binding method: corpus-selected; values withheld.

Binding-selection assumption: zero-based parameter positions [1]; an empty/NULL selector falls back to synthetic values. Selection SQL (no selected values published):

```sql
SELECT session_id FROM search_content GROUP BY session_id ORDER BY COUNT(*) DESC LIMIT 1
```

```text
12 / 0: SEARCH s USING INDEX sqlite_autoindex_sessions_1 (id=?)
18 / 0: SCAN search_fts VIRTUAL TABLE INDEX 0:M1
23 / 0: SEARCH sc USING INTEGER PRIMARY KEY (rowid=?)
93 / 0: USE TEMP B-TREE FOR ORDER BY
```

Result rows: **50**. Three runs, median **119.434 ms**, range **114.008–120.671 ms**; ordered outputs stable.

### fts-session-count

Separate exact count on every page.

```sql
SELECT COUNT(*) FROM search_fts JOIN search_content sc ON sc.id = search_fts.rowid JOIN sessions s ON s.id = sc.session_id WHERE search_fts MATCH ? AND sc.session_id = ?
```

Synthetic bindings: `["error", "synthetic-session"]`. Observed binding method: corpus-selected; values withheld.

Binding-selection assumption: zero-based parameter positions [1]; an empty/NULL selector falls back to synthetic values. Selection SQL (no selected values published):

```sql
SELECT session_id FROM search_content GROUP BY session_id ORDER BY COUNT(*) DESC LIMIT 1
```

```text
5 / 0: SEARCH s USING COVERING INDEX sqlite_autoindex_sessions_1 (id=?)
10 / 0: SCAN search_fts VIRTUAL TABLE INDEX 0:M1
15 / 0: SEARCH sc USING INTEGER PRIMARY KEY (rowid=?)
```

Result rows: **1**; scalar counts/totals: `[1426]`. Three runs, median **122.327 ms**, range **116.737–132.100 ms**; ordered outputs stable.

### fts-source-page

Deep search/browse page.

```sql
SELECT sc.id, sc.session_id, sc.content_type, sc.turn_number, sc.event_index, sc.timestamp_unix, sc.tool_name, snippet(search_fts, 0, '\x01MARK_OPEN\x01', '\x01MARK_CLOSE\x01', '…', 48), sc.metadata_json, s.summary, s.repository, s.branch, s.updated_at, s.source FROM search_fts JOIN search_content sc ON sc.id = search_fts.rowid JOIN sessions s ON s.id = sc.session_id WHERE search_fts MATCH ? AND s.source = ? ORDER BY CASE sc.content_type WHEN 'user_message' THEN rank * 2.0 WHEN 'error' THEN rank * 2.0 WHEN 'tool_error' THEN rank * 1.8 WHEN 'assistant_message' THEN rank * 1.5 WHEN 'reasoning' THEN rank * 1.3 WHEN 'compaction_summary' THEN rank * 1.1 WHEN 'subagent' THEN rank * 1.1 WHEN 'system_message' THEN rank * 1.0 WHEN 'tool_call' THEN rank * 0.6 WHEN 'tool_result' THEN rank * 0.7 ELSE rank END LIMIT ? OFFSET ?
```

Synthetic bindings: `["error", "claudeCode", 50, 0]`. Observed binding method: synthetic.

```text
12 / 0: SCAN search_fts VIRTUAL TABLE INDEX 0:M1
17 / 0: SEARCH sc USING INTEGER PRIMARY KEY (rowid=?)
20 / 0: SEARCH s USING INDEX sqlite_autoindex_sessions_1 (id=?)
93 / 0: USE TEMP B-TREE FOR ORDER BY
```

Result rows: **50**. Three runs, median **230.752 ms**, range **205.108–231.012 ms**; ordered outputs stable.

### fts-source-count

Separate exact count on every page.

```sql
SELECT COUNT(*) FROM search_fts JOIN search_content sc ON sc.id = search_fts.rowid JOIN sessions s ON s.id = sc.session_id WHERE search_fts MATCH ? AND s.source = ?
```

Synthetic bindings: `["error", "claudeCode"]`. Observed binding method: synthetic.

```text
6 / 0: SCAN search_fts VIRTUAL TABLE INDEX 0:M1
11 / 0: SEARCH sc USING INTEGER PRIMARY KEY (rowid=?)
14 / 0: SEARCH s USING INDEX sqlite_autoindex_sessions_1 (id=?)
```

Result rows: **1**; scalar counts/totals: `[4528]`. Three runs, median **159.618 ms**, range **117.412–166.657 ms**; ordered outputs stable.

### fts-source-facet-type

Facet cache miss; own filter omitted.

```sql
SELECT sc.content_type, COUNT(*) FROM search_fts JOIN search_content sc ON sc.id = search_fts.rowid JOIN sessions s ON s.id = sc.session_id WHERE search_fts MATCH ? AND s.source = ? GROUP BY sc.content_type ORDER BY COUNT(*) DESC
```

Synthetic bindings: `["error", "claudeCode"]`. Observed binding method: synthetic.

```text
10 / 0: SCAN search_fts VIRTUAL TABLE INDEX 0:M1
15 / 0: SEARCH sc USING INTEGER PRIMARY KEY (rowid=?)
18 / 0: SEARCH s USING INDEX sqlite_autoindex_sessions_1 (id=?)
25 / 0: USE TEMP B-TREE FOR GROUP BY
61 / 0: USE TEMP B-TREE FOR ORDER BY
```

Result rows: **9**. Three runs, median **122.251 ms**, range **107.237–130.084 ms**; ordered outputs stable.

### fts-source-facet-repo

Facet cache miss; own filter omitted.

```sql
SELECT s.repository, COUNT(*) FROM search_fts JOIN search_content sc ON sc.id = search_fts.rowid JOIN sessions s ON s.id = sc.session_id WHERE search_fts MATCH ? AND s.source = ? AND s.repository IS NOT NULL GROUP BY s.repository ORDER BY COUNT(*) DESC LIMIT ?
```

Synthetic bindings: `["error", "claudeCode", 20]`. Observed binding method: synthetic.

```text
13 / 0: SCAN search_fts VIRTUAL TABLE INDEX 0:M1
18 / 0: SEARCH sc USING INTEGER PRIMARY KEY (rowid=?)
21 / 0: SEARCH s USING INDEX sqlite_autoindex_sessions_1 (id=?)
30 / 0: USE TEMP B-TREE FOR GROUP BY
71 / 0: USE TEMP B-TREE FOR ORDER BY
```

Result rows: **4**. Three runs, median **124.687 ms**, range **124.371–128.353 ms**; ordered outputs stable.

### fts-source-facet-tool

Facet cache miss; own filter omitted.

```sql
SELECT sc.tool_name, COUNT(*) FROM search_fts JOIN search_content sc ON sc.id = search_fts.rowid JOIN sessions s ON s.id = sc.session_id WHERE search_fts MATCH ? AND s.source = ? AND sc.tool_name IS NOT NULL GROUP BY sc.tool_name ORDER BY COUNT(*) DESC LIMIT ?
```

Synthetic bindings: `["error", "claudeCode", 20]`. Observed binding method: synthetic.

```text
13 / 0: SCAN search_fts VIRTUAL TABLE INDEX 0:M1
18 / 0: SEARCH sc USING INTEGER PRIMARY KEY (rowid=?)
23 / 0: SEARCH s USING INDEX sqlite_autoindex_sessions_1 (id=?)
30 / 0: USE TEMP B-TREE FOR GROUP BY
71 / 0: USE TEMP B-TREE FOR ORDER BY
```

Result rows: **16**. Three runs, median **123.682 ms**, range **110.830–135.903 ms**; ordered outputs stable.

### fts-source-totals

Facet exact total/distinct sessions.

```sql
SELECT COUNT(*), COUNT(DISTINCT sc.session_id) FROM search_fts JOIN search_content sc ON sc.id = search_fts.rowid JOIN sessions s ON s.id = sc.session_id WHERE search_fts MATCH ? AND s.source = ?
```

Synthetic bindings: `["error", "claudeCode"]`. Observed binding method: synthetic.

```text
3 / 0: USE TEMP B-TREE FOR count(DISTINCT)
8 / 0: SCAN search_fts VIRTUAL TABLE INDEX 0:M1
13 / 0: SEARCH sc USING INTEGER PRIMARY KEY (rowid=?)
16 / 0: SEARCH s USING INDEX sqlite_autoindex_sessions_1 (id=?)
```

Result rows: **1**; scalar counts/totals: `[4528, 103]`. Three runs, median **107.408 ms**, range **104.373–115.373 ms**; ordered outputs stable.

### browse-deep-offset

Later page worst shape; preserve actual OFFSET.

```sql
SELECT sc.id, sc.session_id, sc.content_type, sc.turn_number, sc.event_index, sc.timestamp_unix, sc.tool_name, CASE WHEN LENGTH(sc.content) > 200 THEN SUBSTR(sc.content, 1, 200) || '…' ELSE sc.content END, sc.metadata_json, s.summary, s.repository, s.branch, s.updated_at, s.source FROM search_content sc JOIN sessions s ON s.id = sc.session_id WHERE 1=1 ORDER BY sc.timestamp_unix DESC NULLS LAST LIMIT ? OFFSET ?
```

Synthetic bindings: `[50, 10000]`. Observed binding method: synthetic.

```text
13 / 0: SCAN sc USING INDEX idx_search_content_timestamp
16 / 0: SEARCH s USING INDEX sqlite_autoindex_sessions_1 (id=?)
```

Result rows: **50**. Three runs, median **5.058 ms**, range **4.635–8.759 ms**; ordered outputs stable.

### fts-common-newest

FTS chronological sort.

```sql
SELECT sc.id, sc.session_id, sc.content_type, sc.turn_number, sc.event_index, sc.timestamp_unix, sc.tool_name, snippet(search_fts, 0, '\x01MARK_OPEN\x01', '\x01MARK_CLOSE\x01', '…', 48), sc.metadata_json, s.summary, s.repository, s.branch, s.updated_at, s.source FROM search_fts JOIN search_content sc ON sc.id = search_fts.rowid JOIN sessions s ON s.id = sc.session_id WHERE search_fts MATCH ? ORDER BY sc.timestamp_unix DESC NULLS LAST LIMIT ? OFFSET ?
```

Synthetic bindings: `["error", 50, 0]`. Observed binding method: synthetic.

```text
12 / 0: SCAN search_fts VIRTUAL TABLE INDEX 0:M1
17 / 0: SEARCH sc USING INTEGER PRIMARY KEY (rowid=?)
20 / 0: SEARCH s USING INDEX sqlite_autoindex_sessions_1 (id=?)
49 / 0: USE TEMP B-TREE FOR ORDER BY
```

Result rows: **50**. Three runs, median **143.672 ms**, range **132.825–147.555 ms**; ordered outputs stable.

### list-all

Session Explorer.

```sql
SELECT id, path, summary, repository, branch, cwd, host_type, created_at, updated_at, event_count, turn_count, current_model, copilot_version, error_count, rate_limit_count, compaction_count, truncation_count, source FROM sessions WHERE 1=1 ORDER BY updated_at DESC LIMIT ?
```

Synthetic bindings: `[100]`. Observed binding method: synthetic.

```text
8 / 0: SCAN sessions USING INDEX idx_sessions_updated_at
```

Result rows: **100**. Three runs, median **0.588 ms**, range **0.579–1.111 ms**; ordered outputs stable.

### list-nonempty

Session Explorer.

```sql
SELECT id, path, summary, repository, branch, cwd, host_type, created_at, updated_at, event_count, turn_count, current_model, copilot_version, error_count, rate_limit_count, compaction_count, truncation_count, source FROM sessions WHERE 1=1 AND turn_count IS NOT NULL AND turn_count > 0 ORDER BY updated_at DESC LIMIT ?
```

Synthetic bindings: `[100]`. Observed binding method: synthetic.

```text
8 / 0: SCAN sessions USING INDEX idx_sessions_nonempty_updated_at
```

Result rows: **100**. Three runs, median **0.592 ms**, range **0.576–0.800 ms**; ordered outputs stable.

### list-repo

Session Explorer.

```sql
SELECT id, path, summary, repository, branch, cwd, host_type, created_at, updated_at, event_count, turn_count, current_model, copilot_version, error_count, rate_limit_count, compaction_count, truncation_count, source FROM sessions WHERE 1=1 AND repository = ? ORDER BY updated_at DESC LIMIT ?
```

Synthetic bindings: `["example/project", 100]`. Observed binding method: corpus-selected; values withheld.

Binding-selection assumption: leading parameters in projection order; an empty/NULL selector falls back to synthetic values. Selection SQL (no selected values published):

```sql
SELECT repository FROM sessions WHERE repository IS NOT NULL GROUP BY repository ORDER BY COUNT(*) DESC LIMIT 1
```

```text
8 / 0: SEARCH sessions USING INDEX idx_sessions_repo_updated (repository=?)
```

Result rows: **100**. Three runs, median **0.624 ms**, range **0.573–0.785 ms**; ordered outputs stable.

### list-branch

Session Explorer.

```sql
SELECT id, path, summary, repository, branch, cwd, host_type, created_at, updated_at, event_count, turn_count, current_model, copilot_version, error_count, rate_limit_count, compaction_count, truncation_count, source FROM sessions WHERE 1=1 AND branch = ? ORDER BY updated_at DESC LIMIT ?
```

Synthetic bindings: `["feature/synthetic", 100]`. Observed binding method: corpus-selected; values withheld.

Binding-selection assumption: leading parameters in projection order; an empty/NULL selector falls back to synthetic values. Selection SQL (no selected values published):

```sql
SELECT branch FROM sessions WHERE branch IS NOT NULL GROUP BY branch ORDER BY COUNT(*) DESC LIMIT 1
```

```text
8 / 0: SCAN sessions USING INDEX idx_sessions_updated_at
```

Result rows: **100**. Three runs, median **0.643 ms**, range **0.641–0.729 ms**; ordered outputs stable.

### list-repo-nonempty

Session Explorer.

```sql
SELECT id, path, summary, repository, branch, cwd, host_type, created_at, updated_at, event_count, turn_count, current_model, copilot_version, error_count, rate_limit_count, compaction_count, truncation_count, source FROM sessions WHERE 1=1 AND turn_count IS NOT NULL AND turn_count > 0 AND repository = ? ORDER BY updated_at DESC LIMIT ?
```

Synthetic bindings: `["example/project", 100]`. Observed binding method: corpus-selected; values withheld.

Binding-selection assumption: leading parameters in projection order; an empty/NULL selector falls back to synthetic values. Selection SQL (no selected values published):

```sql
SELECT repository FROM sessions WHERE repository IS NOT NULL GROUP BY repository ORDER BY COUNT(*) DESC LIMIT 1
```

```text
8 / 0: SEARCH sessions USING INDEX idx_sessions_repo_updated (repository=?)
```

Result rows: **100**. Three runs, median **0.590 ms**, range **0.574–0.729 ms**; ordered outputs stable.

### toolbar-metadata-fts

Metadata toolbar.

```sql
SELECT s.id, s.path, s.summary, s.repository, s.branch, s.cwd, s.host_type, s.created_at, s.updated_at, s.event_count, s.turn_count, s.current_model, s.copilot_version, s.error_count, s.rate_limit_count, s.compaction_count, s.truncation_count, s.source FROM sessions_fts f INNER JOIN sessions s ON s.rowid = f.rowid WHERE sessions_fts MATCH ? ORDER BY s.updated_at DESC, s.id ASC
```

Synthetic bindings: `["example"]`. Observed binding method: synthetic.

```text
4 / 0: SCAN f VIRTUAL TABLE INDEX 0:M4
9 / 0: SEARCH s USING INTEGER PRIMARY KEY (rowid=?)
33 / 0: USE TEMP B-TREE FOR ORDER BY
```

Result rows: **1**. Three runs, median **0.042 ms**, range **0.035–0.189 ms**; ordered outputs stable.

### context-before

Expanded result context.

```sql
SELECT id, content_type, turn_number, event_index, tool_name, CASE WHEN json_valid(metadata_json) THEN json_extract(metadata_json, '$.nativeToolName') END AS native_tool_name, substr(content, 1, 300) AS preview FROM search_content WHERE session_id = ?1 AND event_index < ?2 AND event_index IS NOT NULL ORDER BY event_index DESC LIMIT ?3
```

Synthetic bindings: `["synthetic-session", 100, 2]`. Observed binding method: corpus-selected; values withheld.

Binding-selection assumption: leading parameters in projection order; an empty/NULL selector falls back to synthetic values. Selection SQL (no selected values published):

```sql
SELECT session_id, event_index FROM search_content WHERE event_index IS NOT NULL ORDER BY id DESC LIMIT 1
```

```text
7 / 0: SEARCH search_content USING INDEX idx_search_content_session_event (session_id=? AND event_index>? AND event_index<?)
```

Result rows: **2**. Three runs, median **0.021 ms**, range **0.015–0.337 ms**; ordered outputs stable.

### context-after

Expanded result context.

```sql
SELECT id, content_type, turn_number, event_index, tool_name, CASE WHEN json_valid(metadata_json) THEN json_extract(metadata_json, '$.nativeToolName') END AS native_tool_name, substr(content, 1, 300) AS preview FROM search_content WHERE session_id = ?1 AND event_index > ?2 AND event_index IS NOT NULL ORDER BY event_index ASC LIMIT ?3
```

Synthetic bindings: `["synthetic-session", 100, 2]`. Observed binding method: corpus-selected; values withheld.

Binding-selection assumption: leading parameters in projection order; an empty/NULL selector falls back to synthetic values. Selection SQL (no selected values published):

```sql
SELECT session_id, event_index FROM search_content WHERE event_index IS NOT NULL ORDER BY id DESC LIMIT 1
```

```text
7 / 0: SEARCH search_content USING INDEX idx_search_content_session_event (session_id=? AND event_index>?)
```

Result rows: **0**. Three runs, median **0.007 ms**, range **0.004–0.038 ms**; ordered outputs stable.

### native-tool-provenance

Source-aware tool picker.

```sql
SELECT sc.tool_name, s.source, CASE WHEN json_valid(metadata_json) THEN json_extract(metadata_json, '$.nativeToolName') END AS native_tool_name, COUNT(*) FROM sessions s CROSS JOIN search_content sc ON sc.session_id = s.id WHERE s.source != ?1 AND sc.tool_name IS NOT NULL GROUP BY sc.tool_name, s.source, native_tool_name
```

Synthetic bindings: `["copilot"]`. Observed binding method: synthetic.

```text
8 / 0: SCAN s
12 / 0: SEARCH sc USING INDEX idx_search_content_session_event (session_id=?)
20 / 0: USE TEMP B-TREE FOR GROUP BY
```

Result rows: **42**. Three runs, median **103.558 ms**, range **103.052–104.421 ms**; ordered outputs stable.

### source-reconciliation

Refresh prune discovery.

```sql
SELECT id FROM sessions WHERE source = ?1
```

Synthetic bindings: `["copilot"]`. Observed binding method: synthetic.

```text
3 / 0: SEARCH sessions USING INDEX idx_sessions_source (source=?)
```

Result rows: **619**. Three runs, median **0.791 ms**, range **0.689–1.740 ms**; ordered outputs stable.

### analytics-load_runs-1

Full actual production projection; crates/tracepilot-indexer/src/index_db/analytics_queries/agents.rs:136.

```sql
SELECT r.session_id, s.summary, s.repository, r.run_key, r.tool_call_id, r.agent_name,
                r.agent_type, r.display_name, r.description, r.execution_mode, COALESCE(r.started_at, s.created_at),
                r.outcome, r.error_text, r.model, r.configured_model, r.first_dispatched_model,
                r.model_override_reason, r.configured_matches_actual, r.multi_turn,
                r.total_tool_calls, r.total_tokens, r.duration_ms, r.own_nano_aiu,
                r.follow_up_count, r.depth, r.peak_siblings, r.parent_agent_name,
                r.turn_index, r.event_index, r.messages_sent, r.messages_received,
                r.peer_messages, r.queued_messages
         FROM session_agent_runs r
         JOIN sessions s ON s.id = r.session_id WHERE 1=1
         ORDER BY COALESCE(r.started_at, s.created_at) DESC, r.session_id, r.run_key
```

Synthetic bindings: `[]`. Observed binding method: synthetic.

```text
7 / 0: SCAN r USING INDEX sqlite_autoindex_session_agent_runs_1
10 / 0: SEARCH s USING INDEX sqlite_autoindex_sessions_1 (id=?)
54 / 0: USE TEMP B-TREE FOR ORDER BY
```

Result rows: **5,825**. Three runs, median **63.018 ms**, range **61.917–71.455 ms**; ordered outputs stable.

### analytics-sessions_with_unfinished_runs-1

Full actual production projection; crates/tracepilot-indexer/src/index_db/analytics_queries/agents.rs:226.

```sql
SELECT s.id, s.path, s.source, s.role, s.parent_session_id FROM sessions s
         WHERE EXISTS (SELECT 1 FROM session_agent_runs r
                       WHERE r.session_id = s.id AND r.outcome = 'incomplete')
         ORDER BY s.id
```

Synthetic bindings: `[]`. Observed binding method: synthetic.

```text
4 / 0: SCAN s USING INDEX sqlite_autoindex_sessions_1
8 / 0: CORRELATED SCALAR SUBQUERY 1
13 / 8: SEARCH r USING INDEX sqlite_autoindex_session_agent_runs_1 (session_id=?)
```

Result rows: **15**. Three runs, median **2.080 ms**, range **1.826–2.385 ms**; ordered outputs stable.

### analytics-query_selections-1

Full actual production projection; crates/tracepilot-indexer/src/index_db/analytics_queries/agents.rs:282.

```sql
SELECT MAX(a.agent_name), MAX(a.display_name), COUNT(DISTINCT a.session_id),
                MAX(COALESCE(a.timestamp, s.created_at))
         FROM session_agent_selections a
         JOIN sessions s ON s.id = a.session_id WHERE a.selected = 1 AND a.agent_name IS NOT NULL
         GROUP BY LOWER(a.agent_name)
         ORDER BY COUNT(DISTINCT a.session_id) DESC, LOWER(a.agent_name)
```

Synthetic bindings: `[]`. Observed binding method: synthetic.

```text
9 / 0: SCAN s
11 / 0: SEARCH a USING INDEX sqlite_autoindex_session_agent_selections_1 (session_id=?)
21 / 0: USE TEMP B-TREE FOR GROUP BY
83 / 0: USE TEMP B-TREE FOR count(DISTINCT)
86 / 0: USE TEMP B-TREE FOR ORDER BY
```

Result rows: **0**. Three runs, median **0.067 ms**, range **0.059–0.319 ms**; ordered outputs stable.

### analytics-query_code_impact-1

Full actual production projection; crates/tracepilot-indexer/src/index_db/analytics_queries/code_impact.rs:27.

```sql
SELECT COALESCE(SUM(s.lines_added), 0), COALESCE(SUM(s.lines_removed), 0)
             FROM sessions s WHERE 1=1
```

Synthetic bindings: `[]`. Observed binding method: synthetic.

```text
4 / 0: SCAN s
```

Result rows: **1**. Three runs, median **0.109 ms**, range **0.105–0.153 ms**; ordered outputs stable.

### analytics-query_code_impact-1-filtered

Actual shared date/repository/source/nonempty filter.

```sql
SELECT COALESCE(SUM(s.lines_added), 0), COALESCE(SUM(s.lines_removed), 0)
             FROM sessions s WHERE 1=1 AND s.turn_count IS NOT NULL AND s.turn_count > 0 AND (date(COALESCE(s.updated_at, s.created_at)) >= ? OR (s.updated_at IS NULL AND s.created_at IS NULL)) AND (date(COALESCE(s.updated_at, s.created_at)) <= ? OR (s.updated_at IS NULL AND s.created_at IS NULL)) AND s.repository = ? AND s.source = ?
```

Synthetic bindings: `["2026-01-01", "2026-12-31", "example/project", "copilot"]`. Observed binding method: corpus-selected; values withheld.

Binding-selection assumption: zero-based parameter positions [2]; an empty/NULL selector falls back to synthetic values. Selection SQL (no selected values published):

```sql
SELECT repository FROM sessions WHERE repository IS NOT NULL GROUP BY repository ORDER BY COUNT(*) DESC LIMIT 1
```

```text
5 / 0: SEARCH s USING INDEX idx_sessions_source (source=?)
```

Result rows: **1**. Three runs, median **0.241 ms**, range **0.236–0.338 ms**; ordered outputs stable.

### analytics-query_code_impact-2

Full actual production projection; crates/tracepilot-indexer/src/index_db/analytics_queries/code_impact.rs:39.

```sql
SELECT COALESCE(f.extension, '(no ext)'), COUNT(DISTINCT f.session_id || '|' || REPLACE(f.file_path, '\', '/'))
             FROM session_modified_files f
             JOIN sessions s ON s.id = f.session_id WHERE 1=1
             GROUP BY f.extension ORDER BY 2 DESC
```

Synthetic bindings: `[]`. Observed binding method: synthetic.

```text
9 / 0: SCAN f
11 / 0: SEARCH s USING COVERING INDEX sqlite_autoindex_sessions_1 (id=?)
15 / 0: USE TEMP B-TREE FOR GROUP BY
62 / 0: USE TEMP B-TREE FOR count(DISTINCT)
65 / 0: USE TEMP B-TREE FOR ORDER BY
```

Result rows: **35**. Three runs, median **12.206 ms**, range **11.779–12.712 ms**; ordered outputs stable.

### analytics-query_code_impact-2-filtered

Actual shared date/repository/source/nonempty filter.

```sql
SELECT COALESCE(f.extension, '(no ext)'), COUNT(DISTINCT f.session_id || '|' || REPLACE(f.file_path, '\', '/'))
             FROM session_modified_files f
             JOIN sessions s ON s.id = f.session_id WHERE 1=1 AND s.turn_count IS NOT NULL AND s.turn_count > 0 AND (date(COALESCE(s.updated_at, s.created_at)) >= ? OR (s.updated_at IS NULL AND s.created_at IS NULL)) AND (date(COALESCE(s.updated_at, s.created_at)) <= ? OR (s.updated_at IS NULL AND s.created_at IS NULL)) AND s.repository = ? AND s.source = ?
             GROUP BY f.extension ORDER BY 2 DESC
```

Synthetic bindings: `["2026-01-01", "2026-12-31", "example/project", "copilot"]`. Observed binding method: corpus-selected; values withheld.

Binding-selection assumption: zero-based parameter positions [2]; an empty/NULL selector falls back to synthetic values. Selection SQL (no selected values published):

```sql
SELECT repository FROM sessions WHERE repository IS NOT NULL GROUP BY repository ORDER BY COUNT(*) DESC LIMIT 1
```

```text
11 / 0: SEARCH s USING INDEX idx_sessions_source (source=?)
42 / 0: SEARCH f USING INDEX sqlite_autoindex_session_modified_files_1 (session_id=?)
48 / 0: USE TEMP B-TREE FOR GROUP BY
95 / 0: USE TEMP B-TREE FOR count(DISTINCT)
98 / 0: USE TEMP B-TREE FOR ORDER BY
```

Result rows: **18**. Three runs, median **5.244 ms**, range **5.078–6.095 ms**; ordered outputs stable.

### analytics-query_code_impact-3

Full actual production projection; crates/tracepilot-indexer/src/index_db/analytics_queries/code_impact.rs:75.

```sql
SELECT MAX(f.file_path), COUNT(DISTINCT f.session_id)
             FROM session_modified_files f
             JOIN sessions s ON s.id = f.session_id WHERE 1=1
             GROUP BY REPLACE(f.file_path, '\', '/') ORDER BY 2 DESC LIMIT 20
```

Synthetic bindings: `[]`. Observed binding method: synthetic.

```text
10 / 0: SCAN s USING COVERING INDEX sqlite_autoindex_sessions_1
12 / 0: SEARCH f USING COVERING INDEX sqlite_autoindex_session_modified_files_1 (session_id=?)
17 / 0: USE TEMP B-TREE FOR GROUP BY
66 / 0: USE TEMP B-TREE FOR count(DISTINCT)
69 / 0: USE TEMP B-TREE FOR ORDER BY
```

Result rows: **20**. Three runs, median **9.807 ms**, range **9.498–10.528 ms**; ordered outputs stable.

### analytics-query_code_impact-3-filtered

Actual shared date/repository/source/nonempty filter.

```sql
SELECT MAX(f.file_path), COUNT(DISTINCT f.session_id)
             FROM session_modified_files f
             JOIN sessions s ON s.id = f.session_id WHERE 1=1 AND s.turn_count IS NOT NULL AND s.turn_count > 0 AND (date(COALESCE(s.updated_at, s.created_at)) >= ? OR (s.updated_at IS NULL AND s.created_at IS NULL)) AND (date(COALESCE(s.updated_at, s.created_at)) <= ? OR (s.updated_at IS NULL AND s.created_at IS NULL)) AND s.repository = ? AND s.source = ?
             GROUP BY REPLACE(f.file_path, '\', '/') ORDER BY 2 DESC LIMIT 20
```

Synthetic bindings: `["2026-01-01", "2026-12-31", "example/project", "copilot"]`. Observed binding method: corpus-selected; values withheld.

Binding-selection assumption: zero-based parameter positions [2]; an empty/NULL selector falls back to synthetic values. Selection SQL (no selected values published):

```sql
SELECT repository FROM sessions WHERE repository IS NOT NULL GROUP BY repository ORDER BY COUNT(*) DESC LIMIT 1
```

```text
11 / 0: SEARCH s USING INDEX idx_sessions_source (source=?)
42 / 0: SEARCH f USING COVERING INDEX sqlite_autoindex_session_modified_files_1 (session_id=?)
47 / 0: USE TEMP B-TREE FOR GROUP BY
96 / 0: USE TEMP B-TREE FOR count(DISTINCT)
99 / 0: USE TEMP B-TREE FOR ORDER BY
```

Result rows: **20**. Three runs, median **4.601 ms**, range **4.426–4.713 ms**; ordered outputs stable.

### analytics-query_code_impact-4

Full actual production projection; crates/tracepilot-indexer/src/index_db/analytics_queries/code_impact.rs:97.

```sql
SELECT COUNT(DISTINCT REPLACE(f.file_path, '\', '/'))
             FROM session_modified_files f
             JOIN sessions s ON s.id = f.session_id WHERE 1=1
```

Synthetic bindings: `[]`. Observed binding method: synthetic.

```text
3 / 0: USE TEMP B-TREE FOR count(DISTINCT)
7 / 0: SCAN s USING COVERING INDEX sqlite_autoindex_sessions_1
9 / 0: SEARCH f USING COVERING INDEX sqlite_autoindex_session_modified_files_1 (session_id=?)
```

Result rows: **1**; scalar counts/totals: `[3990]`. Three runs, median **6.870 ms**, range **6.728–7.287 ms**; ordered outputs stable.

### analytics-query_code_impact-4-filtered

Actual shared date/repository/source/nonempty filter.

```sql
SELECT COUNT(DISTINCT REPLACE(f.file_path, '\', '/'))
             FROM session_modified_files f
             JOIN sessions s ON s.id = f.session_id WHERE 1=1 AND s.turn_count IS NOT NULL AND s.turn_count > 0 AND (date(COALESCE(s.updated_at, s.created_at)) >= ? OR (s.updated_at IS NULL AND s.created_at IS NULL)) AND (date(COALESCE(s.updated_at, s.created_at)) <= ? OR (s.updated_at IS NULL AND s.created_at IS NULL)) AND s.repository = ? AND s.source = ?
```

Synthetic bindings: `["2026-01-01", "2026-12-31", "example/project", "copilot"]`. Observed binding method: corpus-selected; values withheld.

Binding-selection assumption: zero-based parameter positions [2]; an empty/NULL selector falls back to synthetic values. Selection SQL (no selected values published):

```sql
SELECT repository FROM sessions WHERE repository IS NOT NULL GROUP BY repository ORDER BY COUNT(*) DESC LIMIT 1
```

```text
3 / 0: USE TEMP B-TREE FOR count(DISTINCT)
8 / 0: SEARCH s USING INDEX idx_sessions_source (source=?)
39 / 0: SEARCH f USING COVERING INDEX sqlite_autoindex_session_modified_files_1 (session_id=?)
```

Result rows: **1**; scalar counts/totals: `[1587]`. Three runs, median **3.281 ms**, range **3.244–3.530 ms**; ordered outputs stable.

### analytics-query_code_impact-5

Full actual production projection; crates/tracepilot-indexer/src/index_db/analytics_queries/code_impact.rs:109.

```sql
SELECT date(COALESCE(s.updated_at, s.created_at)) as d,
                    COALESCE(SUM(s.lines_added), 0), COALESCE(SUM(s.lines_removed), 0)
             FROM sessions s
             WHERE 1=1 AND d IS NOT NULL
             GROUP BY d ORDER BY d
```

Synthetic bindings: `[]`. Observed binding method: synthetic.

```text
8 / 0: SCAN s
15 / 0: USE TEMP B-TREE FOR GROUP BY
```

Result rows: **111**. Three runs, median **0.816 ms**, range **0.737–0.965 ms**; ordered outputs stable.

### analytics-query_analytics-1

Full actual production projection; crates/tracepilot-indexer/src/index_db/analytics_queries/dashboard.rs:35.

```sql
SELECT COUNT(*), COALESCE(SUM(total_tokens), 0), COALESCE(SUM(total_cost), 0.0),
                    COALESCE(SUM(turn_count), 0), COALESCE(SUM(tool_call_count), 0),
                    COUNT(CASE WHEN turn_count > 0 THEN 1 END),
                    COALESCE(SUM(total_premium_requests), 0.0),
                    COALESCE(SUM(CASE WHEN total_api_duration_ms > 0 THEN total_api_duration_ms END), 0),
                    COALESCE(SUM(CASE WHEN total_api_duration_ms > 0 THEN
                        (SELECT SUM(m.output_tokens) FROM session_model_metrics m WHERE m.session_id = s.id)
                    END), 0),
                    COUNT(CASE WHEN error_count > 0 THEN 1 END),
                    COALESCE(SUM(rate_limit_count), 0),
                    COALESCE(SUM(compaction_count), 0),
                    COALESCE(SUM(truncation_count), 0),
                    COALESCE(SUM(total_nano_aiu), 0),
                    COUNT(CASE WHEN total_nano_aiu IS NOT NULL THEN 1 END)
             FROM sessions s WHERE 1=1
```

Synthetic bindings: `[]`. Observed binding method: synthetic.

```text
4 / 0: SCAN s
34 / 0: CORRELATED SCALAR SUBQUERY 1
40 / 34: SEARCH m USING INDEX sqlite_autoindex_session_model_metrics_1 (session_id=?)
```

Result rows: **1**; scalar counts/totals: `[729, 15123461883, 3460.23, 80617, 300487, 514, 3462.23, 1912899976, 103009540, 67, 103, 763, 2, 305078805000, 40]`. Three runs, median **0.965 ms**, range **0.925–1.335 ms**; ordered outputs stable.

### analytics-query_analytics-1-filtered

Actual shared date/repository/source/nonempty filter.

```sql
SELECT COUNT(*), COALESCE(SUM(total_tokens), 0), COALESCE(SUM(total_cost), 0.0),
                    COALESCE(SUM(turn_count), 0), COALESCE(SUM(tool_call_count), 0),
                    COUNT(CASE WHEN turn_count > 0 THEN 1 END),
                    COALESCE(SUM(total_premium_requests), 0.0),
                    COALESCE(SUM(CASE WHEN total_api_duration_ms > 0 THEN total_api_duration_ms END), 0),
                    COALESCE(SUM(CASE WHEN total_api_duration_ms > 0 THEN
                        (SELECT SUM(m.output_tokens) FROM session_model_metrics m WHERE m.session_id = s.id)
                    END), 0),
                    COUNT(CASE WHEN error_count > 0 THEN 1 END),
                    COALESCE(SUM(rate_limit_count), 0),
                    COALESCE(SUM(compaction_count), 0),
                    COALESCE(SUM(truncation_count), 0),
                    COALESCE(SUM(total_nano_aiu), 0),
                    COUNT(CASE WHEN total_nano_aiu IS NOT NULL THEN 1 END)
             FROM sessions s WHERE 1=1 AND s.turn_count IS NOT NULL AND s.turn_count > 0 AND (date(COALESCE(s.updated_at, s.created_at)) >= ? OR (s.updated_at IS NULL AND s.created_at IS NULL)) AND (date(COALESCE(s.updated_at, s.created_at)) <= ? OR (s.updated_at IS NULL AND s.created_at IS NULL)) AND s.repository = ? AND s.source = ?
```

Synthetic bindings: `["2026-01-01", "2026-12-31", "example/project", "copilot"]`. Observed binding method: corpus-selected; values withheld.

Binding-selection assumption: zero-based parameter positions [2]; an empty/NULL selector falls back to synthetic values. Selection SQL (no selected values published):

```sql
SELECT repository FROM sessions WHERE repository IS NOT NULL GROUP BY repository ORDER BY COUNT(*) DESC LIMIT 1
```

```text
5 / 0: SEARCH s USING INDEX idx_sessions_source (source=?)
64 / 0: CORRELATED SCALAR SUBQUERY 1
70 / 64: SEARCH m USING INDEX sqlite_autoindex_session_model_metrics_1 (session_id=?)
```

Result rows: **1**; scalar counts/totals: `[267, 6964238819, 2676.3, 48309, 207834, 267, 2676.3, 1345954113, 61990062, 46, 80, 556, 1, 279111942200, 20]`. Three runs, median **0.794 ms**, range **0.778–1.084 ms**; ordered outputs stable.

### analytics-query_analytics-2

Full actual production projection; crates/tracepilot-indexer/src/index_db/analytics_queries/dashboard.rs:174.

```sql
SELECT m.model_name,
                    SUM(m.input_tokens + m.output_tokens),
                    SUM(m.input_tokens),
                    SUM(m.output_tokens),
                    SUM(m.cache_read_tokens),
                    SUM(m.cache_write_tokens),
                    SUM(m.cost),
                    SUM(m.request_count),
                    SUM(COALESCE(m.reasoning_tokens, 0)),
                    MAX(CASE WHEN m.reasoning_tokens IS NOT NULL THEN 1 ELSE 0 END),
                    SUM(COALESCE(m.total_nano_aiu, 0)),
                    MAX(CASE WHEN m.total_nano_aiu IS NOT NULL THEN 1 ELSE 0 END),
                    SUM(CASE WHEN m.total_nano_aiu IS NULL THEN m.input_tokens ELSE 0 END),
                    SUM(CASE WHEN m.total_nano_aiu IS NULL THEN m.output_tokens ELSE 0 END),
                    SUM(CASE WHEN m.total_nano_aiu IS NULL THEN m.cache_read_tokens ELSE 0 END),
                    SUM(CASE WHEN m.total_nano_aiu IS NULL THEN m.cache_write_tokens ELSE 0 END),
                    s.source,
                    SUM(m.cost_usd),
                    COUNT(m.cost_usd) > 0 AND COUNT(m.cost_usd) < COUNT(*)
             FROM session_model_metrics m
             JOIN sessions s ON s.id = m.session_id WHERE 1=1
             GROUP BY m.model_name, s.source ORDER BY 2 DESC
```

Synthetic bindings: `[]`. Observed binding method: synthetic.

```text
11 / 0: SCAN m USING INDEX sqlite_autoindex_session_model_metrics_1
14 / 0: SEARCH s USING INDEX sqlite_autoindex_sessions_1 (id=?)
19 / 0: USE TEMP B-TREE FOR GROUP BY
165 / 0: USE TEMP B-TREE FOR ORDER BY
```

Result rows: **25**. Three runs, median **2.351 ms**, range **2.306–2.603 ms**; ordered outputs stable.

### analytics-query_analytics-2-filtered

Actual shared date/repository/source/nonempty filter.

```sql
SELECT m.model_name,
                    SUM(m.input_tokens + m.output_tokens),
                    SUM(m.input_tokens),
                    SUM(m.output_tokens),
                    SUM(m.cache_read_tokens),
                    SUM(m.cache_write_tokens),
                    SUM(m.cost),
                    SUM(m.request_count),
                    SUM(COALESCE(m.reasoning_tokens, 0)),
                    MAX(CASE WHEN m.reasoning_tokens IS NOT NULL THEN 1 ELSE 0 END),
                    SUM(COALESCE(m.total_nano_aiu, 0)),
                    MAX(CASE WHEN m.total_nano_aiu IS NOT NULL THEN 1 ELSE 0 END),
                    SUM(CASE WHEN m.total_nano_aiu IS NULL THEN m.input_tokens ELSE 0 END),
                    SUM(CASE WHEN m.total_nano_aiu IS NULL THEN m.output_tokens ELSE 0 END),
                    SUM(CASE WHEN m.total_nano_aiu IS NULL THEN m.cache_read_tokens ELSE 0 END),
                    SUM(CASE WHEN m.total_nano_aiu IS NULL THEN m.cache_write_tokens ELSE 0 END),
                    s.source,
                    SUM(m.cost_usd),
                    COUNT(m.cost_usd) > 0 AND COUNT(m.cost_usd) < COUNT(*)
             FROM session_model_metrics m
             JOIN sessions s ON s.id = m.session_id WHERE 1=1 AND s.turn_count IS NOT NULL AND s.turn_count > 0 AND (date(COALESCE(s.updated_at, s.created_at)) >= ? OR (s.updated_at IS NULL AND s.created_at IS NULL)) AND (date(COALESCE(s.updated_at, s.created_at)) <= ? OR (s.updated_at IS NULL AND s.created_at IS NULL)) AND s.repository = ? AND s.source = ?
             GROUP BY m.model_name, s.source ORDER BY 2 DESC
```

Synthetic bindings: `["2026-01-01", "2026-12-31", "example/project", "copilot"]`. Observed binding method: corpus-selected; values withheld.

Binding-selection assumption: zero-based parameter positions [2]; an empty/NULL selector falls back to synthetic values. Selection SQL (no selected values published):

```sql
SELECT repository FROM sessions WHERE repository IS NOT NULL GROUP BY repository ORDER BY COUNT(*) DESC LIMIT 1
```

```text
11 / 0: SEARCH s USING INDEX idx_sessions_source (source=?)
42 / 0: SEARCH m USING INDEX sqlite_autoindex_session_model_metrics_1 (session_id=?)
48 / 0: USE TEMP B-TREE FOR GROUP BY
194 / 0: USE TEMP B-TREE FOR ORDER BY
```

Result rows: **18**. Three runs, median **1.667 ms**, range **1.550–1.765 ms**; ordered outputs stable.

### analytics-query_analytics-3

Full actual production projection; crates/tracepilot-indexer/src/index_db/analytics_queries/dashboard.rs:202.

```sql
SELECT COALESCE(SUM(m.cache_read_tokens), 0), COALESCE(SUM(m.input_tokens), 0)
             FROM session_model_metrics m
             JOIN sessions s ON s.id = m.session_id WHERE 1=1
```

Synthetic bindings: `[]`. Observed binding method: synthetic.

```text
5 / 0: SCAN m
7 / 0: SEARCH s USING COVERING INDEX sqlite_autoindex_sessions_1 (id=?)
```

Result rows: **1**. Three runs, median **0.338 ms**, range **0.336–0.489 ms**; ordered outputs stable.

### analytics-query_analytics-3-filtered

Actual shared date/repository/source/nonempty filter.

```sql
SELECT COALESCE(SUM(m.cache_read_tokens), 0), COALESCE(SUM(m.input_tokens), 0)
             FROM session_model_metrics m
             JOIN sessions s ON s.id = m.session_id WHERE 1=1 AND s.turn_count IS NOT NULL AND s.turn_count > 0 AND (date(COALESCE(s.updated_at, s.created_at)) >= ? OR (s.updated_at IS NULL AND s.created_at IS NULL)) AND (date(COALESCE(s.updated_at, s.created_at)) <= ? OR (s.updated_at IS NULL AND s.created_at IS NULL)) AND s.repository = ? AND s.source = ?
```

Synthetic bindings: `["2026-01-01", "2026-12-31", "example/project", "copilot"]`. Observed binding method: corpus-selected; values withheld.

Binding-selection assumption: zero-based parameter positions [2]; an empty/NULL selector falls back to synthetic values. Selection SQL (no selected values published):

```sql
SELECT repository FROM sessions WHERE repository IS NOT NULL GROUP BY repository ORDER BY COUNT(*) DESC LIMIT 1
```

```text
7 / 0: SEARCH s USING INDEX idx_sessions_source (source=?)
38 / 0: SEARCH m USING INDEX sqlite_autoindex_session_model_metrics_1 (session_id=?)
```

Result rows: **1**. Three runs, median **0.447 ms**, range **0.429–0.826 ms**; ordered outputs stable.

### analytics-query_analytics-4

Full actual production projection; crates/tracepilot-indexer/src/index_db/analytics_queries/dashboard.rs:227.

```sql
SELECT s.total_api_duration_ms FROM sessions s WHERE 1=1 AND s.total_api_duration_ms IS NOT NULL AND s.total_api_duration_ms > 0
```

Synthetic bindings: `[]`. Observed binding method: synthetic.

```text
3 / 0: SCAN s
```

Result rows: **461**. Three runs, median **0.604 ms**, range **0.442–0.609 ms**; ordered outputs stable.

### analytics-query_analytics-4-filtered

Actual shared date/repository/source/nonempty filter.

```sql
SELECT s.total_api_duration_ms FROM sessions s WHERE 1=1 AND s.turn_count IS NOT NULL AND s.turn_count > 0 AND (date(COALESCE(s.updated_at, s.created_at)) >= ? OR (s.updated_at IS NULL AND s.created_at IS NULL)) AND (date(COALESCE(s.updated_at, s.created_at)) <= ? OR (s.updated_at IS NULL AND s.created_at IS NULL)) AND s.repository = ? AND s.source = ? AND s.total_api_duration_ms IS NOT NULL AND s.total_api_duration_ms > 0
```

Synthetic bindings: `["2026-01-01", "2026-12-31", "example/project", "copilot"]`. Observed binding method: corpus-selected; values withheld.

Binding-selection assumption: zero-based parameter positions [2]; an empty/NULL selector falls back to synthetic values. Selection SQL (no selected values published):

```sql
SELECT repository FROM sessions WHERE repository IS NOT NULL GROUP BY repository ORDER BY COUNT(*) DESC LIMIT 1
```

```text
4 / 0: SEARCH s USING INDEX idx_sessions_source (source=?)
```

Result rows: **245**. Three runs, median **0.449 ms**, range **0.441–0.674 ms**; ordered outputs stable.

### analytics-query_analytics-5

Full actual production projection; crates/tracepilot-indexer/src/index_db/analytics_queries/dashboard.rs:265.

```sql
SELECT date(COALESCE(s.updated_at, s.created_at)) as d,
                    COALESCE(SUM(s.error_count), 0),
                    COALESCE(SUM(s.rate_limit_count), 0),
                    COALESCE(SUM(s.compaction_count), 0),
                    COALESCE(SUM(s.truncation_count), 0)
             FROM sessions s WHERE 1=1 AND d IS NOT NULL GROUP BY d ORDER BY d
```

Synthetic bindings: `[]`. Observed binding method: synthetic.

```text
8 / 0: SCAN s
15 / 0: USE TEMP B-TREE FOR GROUP BY
```

Result rows: **111**. Three runs, median **0.886 ms**, range **0.875–0.970 ms**; ordered outputs stable.

### analytics-query_analytics-5-filtered

Actual shared date/repository/source/nonempty filter.

```sql
SELECT date(COALESCE(s.updated_at, s.created_at)) as d,
                    COALESCE(SUM(s.error_count), 0),
                    COALESCE(SUM(s.rate_limit_count), 0),
                    COALESCE(SUM(s.compaction_count), 0),
                    COALESCE(SUM(s.truncation_count), 0)
             FROM sessions s WHERE 1=1 AND s.turn_count IS NOT NULL AND s.turn_count > 0 AND (date(COALESCE(s.updated_at, s.created_at)) >= ? OR (s.updated_at IS NULL AND s.created_at IS NULL)) AND (date(COALESCE(s.updated_at, s.created_at)) <= ? OR (s.updated_at IS NULL AND s.created_at IS NULL)) AND s.repository = ? AND s.source = ? AND d IS NOT NULL GROUP BY d ORDER BY d
```

Synthetic bindings: `["2026-01-01", "2026-12-31", "example/project", "copilot"]`. Observed binding method: corpus-selected; values withheld.

Binding-selection assumption: zero-based parameter positions [2]; an empty/NULL selector falls back to synthetic values. Selection SQL (no selected values published):

```sql
SELECT repository FROM sessions WHERE repository IS NOT NULL GROUP BY repository ORDER BY COUNT(*) DESC LIMIT 1
```

```text
9 / 0: SEARCH s USING INDEX idx_sessions_source (source=?)
45 / 0: USE TEMP B-TREE FOR GROUP BY
```

Result rows: **71**. Three runs, median **0.628 ms**, range **0.614–0.837 ms**; ordered outputs stable.

### analytics-query_model_usage_by_day-1

Full actual production projection; crates/tracepilot-indexer/src/index_db/analytics_queries/model_usage_by_day.rs:57.

```sql
SELECT date(m.end_timestamp) as d, m.model_metrics_json, s.source
             FROM session_segments m
             JOIN sessions s ON s.id = m.session_id
              WHERE 1=1 AND d IS NOT NULL AND m.model_metrics_json IS NOT NULL
             ORDER BY d
```

Synthetic bindings: `[]`. Observed binding method: synthetic.

```text
6 / 0: SCAN m
13 / 0: SEARCH s USING INDEX sqlite_autoindex_sessions_1 (id=?)
26 / 0: USE TEMP B-TREE FOR ORDER BY
```

Result rows: **715**. Three runs, median **2.531 ms**, range **2.524–3.326 ms**; ordered outputs stable.

### analytics-query_model_usage_by_day-1-filtered

Actual shared date/repository/source/nonempty filter.

```sql
SELECT date(m.end_timestamp) as d, m.model_metrics_json, s.source
             FROM session_segments m
             JOIN sessions s ON s.id = m.session_id
              WHERE 1=1 AND s.turn_count IS NOT NULL AND s.turn_count > 0 AND (date(COALESCE(s.updated_at, s.created_at)) >= ? OR (s.updated_at IS NULL AND s.created_at IS NULL)) AND (date(COALESCE(s.updated_at, s.created_at)) <= ? OR (s.updated_at IS NULL AND s.created_at IS NULL)) AND s.repository = ? AND s.source = ? AND d IS NOT NULL AND m.model_metrics_json IS NOT NULL
             ORDER BY d
```

Synthetic bindings: `["2026-01-01", "2026-12-31", "example/project", "copilot"]`. Observed binding method: corpus-selected; values withheld.

Binding-selection assumption: zero-based parameter positions [2]; an empty/NULL selector falls back to synthetic values. Selection SQL (no selected values published):

```sql
SELECT repository FROM sessions WHERE repository IS NOT NULL GROUP BY repository ORDER BY COUNT(*) DESC LIMIT 1
```

```text
7 / 0: SEARCH s USING INDEX idx_sessions_source (source=?)
38 / 0: SEARCH m USING INDEX sqlite_autoindex_session_segments_1 (session_id=?)
57 / 0: USE TEMP B-TREE FOR ORDER BY
```

Result rows: **397**. Three runs, median **1.690 ms**, range **1.614–2.029 ms**; ordered outputs stable.

### analytics-query_model_usage_by_day-2

Full actual production projection; crates/tracepilot-indexer/src/index_db/analytics_queries/model_usage_by_day.rs:86.

```sql
SELECT date(COALESCE(s.updated_at, s.created_at)) as d,
                    m.model_name,
                    s.source,
                    COALESCE(SUM(m.input_tokens), 0),
                    COALESCE(SUM(m.output_tokens), 0),
                    COALESCE(SUM(m.cache_read_tokens), 0),
                    COALESCE(SUM(m.cache_write_tokens), 0),
                    COALESCE(SUM(COALESCE(m.reasoning_tokens, 0)), 0),
                    MAX(CASE WHEN m.reasoning_tokens IS NOT NULL THEN 1 ELSE 0 END),
                    COALESCE(SUM(COALESCE(m.total_nano_aiu, 0)), 0),
                    MAX(CASE WHEN m.total_nano_aiu IS NOT NULL THEN 1 ELSE 0 END),
                    COALESCE(SUM(CASE WHEN m.total_nano_aiu IS NULL THEN m.input_tokens ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN m.total_nano_aiu IS NULL THEN m.output_tokens ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN m.total_nano_aiu IS NULL THEN m.cache_read_tokens ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN m.total_nano_aiu IS NULL THEN m.cache_write_tokens ELSE 0 END), 0)
             FROM session_model_metrics m
             JOIN sessions s ON s.id = m.session_id WHERE 1=1
             AND d IS NOT NULL
             AND NOT EXISTS (
                 SELECT 1 FROM session_segments seg WHERE seg.session_id = s.id
             )
             GROUP BY d, m.model_name, s.source
             ORDER BY d, m.model_name, s.source
```

Synthetic bindings: `[]`. Observed binding method: synthetic.

```text
11 / 0: SCAN m USING INDEX sqlite_autoindex_session_model_metrics_1
14 / 0: SEARCH s USING INDEX sqlite_autoindex_sessions_1 (id=?)
25 / 0: CORRELATED SCALAR SUBQUERY 1
29 / 25: SEARCH seg USING COVERING INDEX sqlite_autoindex_session_segments_1 (session_id=?)
39 / 0: USE TEMP B-TREE FOR GROUP BY
```

Result rows: **0**. Three runs, median **0.870 ms**, range **0.867–1.104 ms**; ordered outputs stable.

### analytics-query_model_usage_by_day-2-filtered

Actual shared date/repository/source/nonempty filter.

```sql
SELECT date(COALESCE(s.updated_at, s.created_at)) as d,
                    m.model_name,
                    s.source,
                    COALESCE(SUM(m.input_tokens), 0),
                    COALESCE(SUM(m.output_tokens), 0),
                    COALESCE(SUM(m.cache_read_tokens), 0),
                    COALESCE(SUM(m.cache_write_tokens), 0),
                    COALESCE(SUM(COALESCE(m.reasoning_tokens, 0)), 0),
                    MAX(CASE WHEN m.reasoning_tokens IS NOT NULL THEN 1 ELSE 0 END),
                    COALESCE(SUM(COALESCE(m.total_nano_aiu, 0)), 0),
                    MAX(CASE WHEN m.total_nano_aiu IS NOT NULL THEN 1 ELSE 0 END),
                    COALESCE(SUM(CASE WHEN m.total_nano_aiu IS NULL THEN m.input_tokens ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN m.total_nano_aiu IS NULL THEN m.output_tokens ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN m.total_nano_aiu IS NULL THEN m.cache_read_tokens ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN m.total_nano_aiu IS NULL THEN m.cache_write_tokens ELSE 0 END), 0)
             FROM session_model_metrics m
             JOIN sessions s ON s.id = m.session_id WHERE 1=1 AND s.turn_count IS NOT NULL AND s.turn_count > 0 AND (date(COALESCE(s.updated_at, s.created_at)) >= ? OR (s.updated_at IS NULL AND s.created_at IS NULL)) AND (date(COALESCE(s.updated_at, s.created_at)) <= ? OR (s.updated_at IS NULL AND s.created_at IS NULL)) AND s.repository = ? AND s.source = ?
             AND d IS NOT NULL
             AND NOT EXISTS (
                 SELECT 1 FROM session_segments seg WHERE seg.session_id = s.id
             )
             GROUP BY d, m.model_name, s.source
             ORDER BY d, m.model_name, s.source
```

Synthetic bindings: `["2026-01-01", "2026-12-31", "example/project", "copilot"]`. Observed binding method: corpus-selected; values withheld.

Binding-selection assumption: zero-based parameter positions [2]; an empty/NULL selector falls back to synthetic values. Selection SQL (no selected values published):

```sql
SELECT repository FROM sessions WHERE repository IS NOT NULL GROUP BY repository ORDER BY COUNT(*) DESC LIMIT 1
```

```text
11 / 0: SEARCH s USING INDEX idx_sessions_source (source=?)
48 / 0: CORRELATED SCALAR SUBQUERY 1
52 / 48: SEARCH seg USING COVERING INDEX sqlite_autoindex_session_segments_1 (session_id=?)
62 / 0: SEARCH m USING INDEX sqlite_autoindex_session_model_metrics_1 (session_id=?)
68 / 0: USE TEMP B-TREE FOR GROUP BY
```

Result rows: **0**. Three runs, median **0.326 ms**, range **0.321–0.595 ms**; ordered outputs stable.

### analytics-query_prompt_cache-1

Full actual production projection; crates/tracepilot-indexer/src/index_db/analytics_queries/prompt_cache.rs:24.

```sql
SELECT w.session_id, w.outcome, w.idle_seconds, w.prefix_tokens, w.change_kinds,
                w.resume_source, w.model
         FROM session_cache_windows w
         JOIN sessions s ON s.id = w.session_id WHERE 1=1
           AND w.resume_at IS NOT NULL
```

Synthetic bindings: `[]`. Observed binding method: synthetic.

```text
4 / 0: SCAN w
8 / 0: SEARCH s USING COVERING INDEX sqlite_autoindex_sessions_1 (id=?)
```

Result rows: **398**. Three runs, median **1.005 ms**, range **0.999–1.192 ms**; ordered outputs stable.

### analytics-query_prompt_cache-1-filtered

Actual shared date/repository/source/nonempty filter.

```sql
SELECT w.session_id, w.outcome, w.idle_seconds, w.prefix_tokens, w.change_kinds,
                w.resume_source, w.model
         FROM session_cache_windows w
         JOIN sessions s ON s.id = w.session_id WHERE 1=1 AND s.turn_count IS NOT NULL AND s.turn_count > 0 AND (date(COALESCE(s.updated_at, s.created_at)) >= ? OR (s.updated_at IS NULL AND s.created_at IS NULL)) AND (date(COALESCE(s.updated_at, s.created_at)) <= ? OR (s.updated_at IS NULL AND s.created_at IS NULL)) AND s.repository = ? AND s.source = ?
           AND w.resume_at IS NOT NULL
```

Synthetic bindings: `["2026-01-01", "2026-12-31", "example/project", "copilot"]`. Observed binding method: corpus-selected; values withheld.

Binding-selection assumption: zero-based parameter positions [2]; an empty/NULL selector falls back to synthetic values. Selection SQL (no selected values published):

```sql
SELECT repository FROM sessions WHERE repository IS NOT NULL GROUP BY repository ORDER BY COUNT(*) DESC LIMIT 1
```

```text
6 / 0: SEARCH s USING INDEX idx_sessions_source (source=?)
37 / 0: SEARCH w USING INDEX sqlite_autoindex_session_cache_windows_1 (session_id=?)
```

Result rows: **18**. Three runs, median **0.316 ms**, range **0.316–0.545 ms**; ordered outputs stable.

### analytics-query_observed_ttls-1

Full actual production projection; crates/tracepilot-indexer/src/index_db/analytics_queries/prompt_cache.rs:109.

```sql
SELECT t.model, t.ttl_seconds, SUM(t.observation_count)
         FROM session_cache_ttls t WHERE 1=1
         GROUP BY t.model, t.ttl_seconds
```

Synthetic bindings: `[]`. Observed binding method: synthetic.

```text
7 / 0: SCAN t
9 / 0: USE TEMP B-TREE FOR GROUP BY
```

Result rows: **3**. Three runs, median **0.023 ms**, range **0.021–0.073 ms**; ordered outputs stable.

### analytics-load_invocations-1

Full actual production projection; crates/tracepilot-indexer/src/index_db/analytics_queries/skills.rs:95.

```sql
SELECT i.session_id, s.summary, s.repository, i.turn_index, i.event_index, COALESCE(i.timestamp, s.created_at),
                i.skill_name, i.normalized_name, i.skill_path, i.normalized_directory,
                i.description, i.source, i.trigger, i.agent_name, i.agent_id, i.model,
                i.plugin_name, i.content_sha256,
                COALESCE(i.frontmatter_tokens, 0) + COALESCE(i.instruction_tokens, 0),
                i.frontmatter_tokens IS NULL AND i.instruction_tokens IS NULL, i.origin
         FROM session_skill_invocations i
         JOIN sessions s ON s.id = i.session_id WHERE 1=1
         ORDER BY COALESCE(i.timestamp, s.created_at) DESC, i.session_id, i.event_index DESC
```

Synthetic bindings: `[]`. Observed binding method: synthetic.

```text
7 / 0: SCAN i USING INDEX sqlite_autoindex_session_skill_invocations_1
10 / 0: SEARCH s USING INDEX sqlite_autoindex_sessions_1 (id=?)
56 / 0: USE TEMP B-TREE FOR ORDER BY
```

Result rows: **181**. Three runs, median **1.484 ms**, range **1.484–1.919 ms**; ordered outputs stable.

### analytics-query_cost_by_source-1

Full actual production projection; crates/tracepilot-indexer/src/index_db/analytics_queries/source_cost.rs:22.

```sql
SELECT s.source, COUNT(*), COALESCE(SUM(s.total_tokens), 0),
                SUM(s.cost_usd), COUNT(s.cost_usd)
         FROM sessions s WHERE 1=1
         GROUP BY s.source
```

Synthetic bindings: `[]`. Observed binding method: synthetic.

```text
8 / 0: SCAN s USING INDEX idx_sessions_source
```

Result rows: **2**. Three runs, median **0.232 ms**, range **0.220–0.411 ms**; ordered outputs stable.

### analytics-query_cost_by_source-1-filtered

Actual shared date/repository/source/nonempty filter.

```sql
SELECT s.source, COUNT(*), COALESCE(SUM(s.total_tokens), 0),
                SUM(s.cost_usd), COUNT(s.cost_usd)
         FROM sessions s WHERE 1=1 AND s.turn_count IS NOT NULL AND s.turn_count > 0 AND (date(COALESCE(s.updated_at, s.created_at)) >= ? OR (s.updated_at IS NULL AND s.created_at IS NULL)) AND (date(COALESCE(s.updated_at, s.created_at)) <= ? OR (s.updated_at IS NULL AND s.created_at IS NULL)) AND s.repository = ? AND s.source = ?
         GROUP BY s.source
```

Synthetic bindings: `["2026-01-01", "2026-12-31", "example/project", "copilot"]`. Observed binding method: corpus-selected; values withheld.

Binding-selection assumption: zero-based parameter positions [2]; an empty/NULL selector falls back to synthetic values. Selection SQL (no selected values published):

```sql
SELECT repository FROM sessions WHERE repository IS NOT NULL GROUP BY repository ORDER BY COUNT(*) DESC LIMIT 1
```

```text
8 / 0: SEARCH s USING INDEX idx_sessions_source (source=?)
```

Result rows: **1**. Three runs, median **0.269 ms**, range **0.267–0.489 ms**; ordered outputs stable.

### analytics-query_tool_analysis-1

Full actual production projection; crates/tracepilot-indexer/src/index_db/analytics_queries/tool_analysis.rs:25.

```sql
SELECT t.tool_name,
                    SUM(t.call_count), SUM(t.success_count), SUM(t.failure_count),
                    SUM(t.total_duration_ms), SUM(t.calls_with_duration)
             FROM session_tool_calls t
             JOIN sessions s ON s.id = t.session_id WHERE 1=1
             GROUP BY t.tool_name ORDER BY SUM(t.call_count) DESC, t.tool_name ASC
```

Synthetic bindings: `[]`. Observed binding method: synthetic.

```text
10 / 0: SCAN t USING INDEX sqlite_autoindex_session_tool_calls_1
13 / 0: SEARCH s USING COVERING INDEX sqlite_autoindex_sessions_1 (id=?)
17 / 0: USE TEMP B-TREE FOR GROUP BY
72 / 0: USE TEMP B-TREE FOR ORDER BY
```

Result rows: **94**. Three runs, median **5.231 ms**, range **5.122–6.901 ms**; ordered outputs stable.

### analytics-query_tool_analysis-1-filtered

Actual shared date/repository/source/nonempty filter.

```sql
SELECT t.tool_name,
                    SUM(t.call_count), SUM(t.success_count), SUM(t.failure_count),
                    SUM(t.total_duration_ms), SUM(t.calls_with_duration)
             FROM session_tool_calls t
             JOIN sessions s ON s.id = t.session_id WHERE 1=1 AND s.turn_count IS NOT NULL AND s.turn_count > 0 AND (date(COALESCE(s.updated_at, s.created_at)) >= ? OR (s.updated_at IS NULL AND s.created_at IS NULL)) AND (date(COALESCE(s.updated_at, s.created_at)) <= ? OR (s.updated_at IS NULL AND s.created_at IS NULL)) AND s.repository = ? AND s.source = ?
             GROUP BY t.tool_name ORDER BY SUM(t.call_count) DESC, t.tool_name ASC
```

Synthetic bindings: `["2026-01-01", "2026-12-31", "example/project", "copilot"]`. Observed binding method: corpus-selected; values withheld.

Binding-selection assumption: zero-based parameter positions [2]; an empty/NULL selector falls back to synthetic values. Selection SQL (no selected values published):

```sql
SELECT repository FROM sessions WHERE repository IS NOT NULL GROUP BY repository ORDER BY COUNT(*) DESC LIMIT 1
```

```text
11 / 0: SEARCH s USING INDEX idx_sessions_source (source=?)
42 / 0: SEARCH t USING INDEX sqlite_autoindex_session_tool_calls_1 (session_id=?)
48 / 0: USE TEMP B-TREE FOR GROUP BY
103 / 0: USE TEMP B-TREE FOR ORDER BY
```

Result rows: **59**. Three runs, median **2.997 ms**, range **2.924–3.177 ms**; ordered outputs stable.

### analytics-query_tool_analysis-2

Full actual production projection; crates/tracepilot-indexer/src/index_db/analytics_queries/tool_analysis.rs:83.

```sql
SELECT a.day_of_week, a.hour, SUM(a.tool_call_count)
             FROM session_activity a
             JOIN sessions s ON s.id = a.session_id WHERE 1=1
             GROUP BY a.day_of_week, a.hour
```

Synthetic bindings: `[]`. Observed binding method: synthetic.

```text
8 / 0: SCAN a
10 / 0: SEARCH s USING COVERING INDEX sqlite_autoindex_sessions_1 (id=?)
14 / 0: USE TEMP B-TREE FOR GROUP BY
```

Result rows: **116**. Three runs, median **0.949 ms**, range **0.941–1.112 ms**; ordered outputs stable.

### analytics-query_tool_analysis-2-filtered

Actual shared date/repository/source/nonempty filter.

```sql
SELECT a.day_of_week, a.hour, SUM(a.tool_call_count)
             FROM session_activity a
             JOIN sessions s ON s.id = a.session_id WHERE 1=1 AND s.turn_count IS NOT NULL AND s.turn_count > 0 AND (date(COALESCE(s.updated_at, s.created_at)) >= ? OR (s.updated_at IS NULL AND s.created_at IS NULL)) AND (date(COALESCE(s.updated_at, s.created_at)) <= ? OR (s.updated_at IS NULL AND s.created_at IS NULL)) AND s.repository = ? AND s.source = ?
             GROUP BY a.day_of_week, a.hour
```

Synthetic bindings: `["2026-01-01", "2026-12-31", "example/project", "copilot"]`. Observed binding method: corpus-selected; values withheld.

Binding-selection assumption: zero-based parameter positions [2]; an empty/NULL selector falls back to synthetic values. Selection SQL (no selected values published):

```sql
SELECT repository FROM sessions WHERE repository IS NOT NULL GROUP BY repository ORDER BY COUNT(*) DESC LIMIT 1
```

```text
10 / 0: SEARCH s USING INDEX idx_sessions_source (source=?)
41 / 0: SEARCH a USING INDEX sqlite_autoindex_session_activity_1 (session_id=?)
47 / 0: USE TEMP B-TREE FOR GROUP BY
```

Result rows: **106**. Three runs, median **0.892 ms**, range **0.844–1.142 ms**; ordered outputs stable.

### analytics-query_calls_by_day-1

Full actual production projection; crates/tracepilot-indexer/src/index_db/analytics_queries/tool_analysis.rs:126.

```sql
SELECT date(COALESCE(s.updated_at, s.created_at)) AS d,
                SUM(t.call_count), SUM(t.failure_count), SUM(t.total_duration_ms)
             FROM session_tool_calls t
             JOIN sessions s ON s.id = t.session_id WHERE 1=1 AND d IS NOT NULL
             GROUP BY d ORDER BY d
```

Synthetic bindings: `[]`. Observed binding method: synthetic.

```text
10 / 0: SCAN t
13 / 0: BLOOM FILTER ON s (id=?)
25 / 0: SEARCH s USING INDEX sqlite_autoindex_sessions_1 (id=?)
36 / 0: USE TEMP B-TREE FOR GROUP BY
```

Result rows: **106**. Three runs, median **5.418 ms**, range **5.402–5.837 ms**; ordered outputs stable.

### analytics-query_calls_by_day-1-filtered

Actual shared date/repository/source/nonempty filter.

```sql
SELECT date(COALESCE(s.updated_at, s.created_at)) AS d,
                SUM(t.call_count), SUM(t.failure_count), SUM(t.total_duration_ms)
             FROM session_tool_calls t
             JOIN sessions s ON s.id = t.session_id WHERE 1=1 AND s.turn_count IS NOT NULL AND s.turn_count > 0 AND (date(COALESCE(s.updated_at, s.created_at)) >= ? OR (s.updated_at IS NULL AND s.created_at IS NULL)) AND (date(COALESCE(s.updated_at, s.created_at)) <= ? OR (s.updated_at IS NULL AND s.created_at IS NULL)) AND s.repository = ? AND s.source = ? AND d IS NOT NULL
             GROUP BY d ORDER BY d
```

Synthetic bindings: `["2026-01-01", "2026-12-31", "example/project", "copilot"]`. Observed binding method: corpus-selected; values withheld.

Binding-selection assumption: zero-based parameter positions [2]; an empty/NULL selector falls back to synthetic values. Selection SQL (no selected values published):

```sql
SELECT repository FROM sessions WHERE repository IS NOT NULL GROUP BY repository ORDER BY COUNT(*) DESC LIMIT 1
```

```text
11 / 0: SEARCH s USING INDEX idx_sessions_source (source=?)
47 / 0: SEARCH t USING INDEX sqlite_autoindex_session_tool_calls_1 (session_id=?)
53 / 0: USE TEMP B-TREE FOR GROUP BY
```

Result rows: **69**. Three runs, median **2.800 ms**, range **2.799–3.176 ms**; ordered outputs stable.

### analytics-query_native_tools-1

Full actual production projection; crates/tracepilot-indexer/src/index_db/analytics_queries/tool_analysis.rs:163.

```sql
SELECT n.tool_name, n.native_tool_name, s.source,
                SUM(n.call_count), SUM(n.success_count), SUM(n.failure_count),
                SUM(n.total_duration_ms), SUM(n.calls_with_duration)
             FROM session_native_tool_calls n
             JOIN sessions s ON s.id = n.session_id WHERE 1=1
             GROUP BY n.tool_name, n.native_tool_name, s.source
             ORDER BY SUM(n.call_count) DESC, n.native_tool_name ASC, s.source ASC
```

Synthetic bindings: `[]`. Observed binding method: synthetic.

```text
10 / 0: SCAN s
12 / 0: SEARCH n USING INDEX sqlite_autoindex_session_native_tool_calls_1 (session_id=?)
18 / 0: USE TEMP B-TREE FOR GROUP BY
80 / 0: USE TEMP B-TREE FOR ORDER BY
```

Result rows: **44**. Three runs, median **1.163 ms**, range **1.161–1.630 ms**; ordered outputs stable.

### analytics-query_native_tools-1-filtered

Actual shared date/repository/source/nonempty filter.

```sql
SELECT n.tool_name, n.native_tool_name, s.source,
                SUM(n.call_count), SUM(n.success_count), SUM(n.failure_count),
                SUM(n.total_duration_ms), SUM(n.calls_with_duration)
             FROM session_native_tool_calls n
             JOIN sessions s ON s.id = n.session_id WHERE 1=1 AND s.turn_count IS NOT NULL AND s.turn_count > 0 AND (date(COALESCE(s.updated_at, s.created_at)) >= ? OR (s.updated_at IS NULL AND s.created_at IS NULL)) AND (date(COALESCE(s.updated_at, s.created_at)) <= ? OR (s.updated_at IS NULL AND s.created_at IS NULL)) AND s.repository = ? AND s.source = ?
             GROUP BY n.tool_name, n.native_tool_name, s.source
             ORDER BY SUM(n.call_count) DESC, n.native_tool_name ASC, s.source ASC
```

Synthetic bindings: `["2026-01-01", "2026-12-31", "example/project", "copilot"]`. Observed binding method: corpus-selected; values withheld.

Binding-selection assumption: zero-based parameter positions [2]; an empty/NULL selector falls back to synthetic values. Selection SQL (no selected values published):

```sql
SELECT repository FROM sessions WHERE repository IS NOT NULL GROUP BY repository ORDER BY COUNT(*) DESC LIMIT 1
```

```text
11 / 0: SEARCH s USING INDEX idx_sessions_source (source=?)
42 / 0: SEARCH n USING INDEX sqlite_autoindex_session_native_tool_calls_1 (session_id=?)
48 / 0: USE TEMP B-TREE FOR GROUP BY
110 / 0: USE TEMP B-TREE FOR ORDER BY
```

Result rows: **0**. Three runs, median **0.270 ms**, range **0.262–0.424 ms**; ordered outputs stable.

### analytics-format_diagnostics-1

Full actual production projection; crates/tracepilot-indexer/src/index_db/format_diagnostics.rs:41.

```sql
SELECT COUNT(*) FROM sessions WHERE source = ?1
```

Synthetic bindings: `["copilot"]`. Observed binding method: synthetic.

```text
3 / 0: SEARCH sessions USING COVERING INDEX idx_sessions_source (source=?)
```

Result rows: **1**; scalar counts/totals: `[619]`. Three runs, median **0.033 ms**, range **0.033–0.072 ms**; ordered outputs stable.

### analytics-format_diagnostics-2

Full actual production projection; crates/tracepilot-indexer/src/index_db/format_diagnostics.rs:48.

```sql
SELECT o.kind, o.name, COUNT(DISTINCT o.session_id), SUM(o.record_count)
             FROM session_format_observations o
             JOIN sessions s ON s.id = o.session_id
             WHERE s.source = ?1
             GROUP BY o.kind, o.name
             ORDER BY o.kind, o.name
```

Synthetic bindings: `["copilot"]`. Observed binding method: synthetic.

```text
10 / 0: SEARCH s USING INDEX idx_sessions_source (source=?)
17 / 0: SEARCH o USING INDEX sqlite_autoindex_session_format_observations_1 (session_id=?)
23 / 0: USE TEMP B-TREE FOR GROUP BY
69 / 0: USE TEMP B-TREE FOR count(DISTINCT)
```

Result rows: **61**. Three runs, median **0.835 ms**, range **0.789–1.095 ms**; ordered outputs stable.

### daily-tokens

Actual day-bucket builder; date() may inhibit standalone timestamp index.

```sql
SELECT date(m.end_timestamp) AS d, COALESCE(SUM(m.total_tokens), 0) FROM session_segments m JOIN sessions s ON s.id = m.session_id WHERE 1=1 AND date(m.end_timestamp) >= ? AND date(m.end_timestamp) <= ? AND d IS NOT NULL GROUP BY d ORDER BY d
```

Synthetic bindings: `["2026-01-01", "2026-12-31"]`. Observed binding method: synthetic.

```text
9 / 0: SCAN m
20 / 0: SEARCH s USING COVERING INDEX sqlite_autoindex_sessions_1 (id=?)
24 / 0: USE TEMP B-TREE FOR GROUP BY
```

Result rows: **107**. Three runs, median **1.025 ms**, range **1.025–1.171 ms**; ordered outputs stable.

### daily-activity

Actual day-bucket builder; date() may inhibit standalone timestamp index.

```sql
SELECT date(m.end_timestamp) AS d, COUNT(*) FROM session_segments m JOIN sessions s ON s.id = m.session_id WHERE 1=1 AND date(m.end_timestamp) >= ? AND date(m.end_timestamp) <= ? AND d IS NOT NULL GROUP BY d ORDER BY d
```

Synthetic bindings: `["2026-01-01", "2026-12-31"]`. Observed binding method: synthetic.

```text
9 / 0: SCAN m USING COVERING INDEX sqlite_autoindex_session_segments_1
20 / 0: SEARCH s USING COVERING INDEX sqlite_autoindex_sessions_1 (id=?)
24 / 0: USE TEMP B-TREE FOR GROUP BY
```

Result rows: **107**. Three runs, median **0.955 ms**, range **0.937–1.211 ms**; ordered outputs stable.

### daily-credits

Actual day-bucket builder; date() may inhibit standalone timestamp index.

```sql
SELECT date(m.end_timestamp) AS d, COALESCE(SUM(m.total_premium_requests), 0.0) FROM session_segments m JOIN sessions s ON s.id = m.session_id WHERE 1=1 AND date(m.end_timestamp) >= ? AND date(m.end_timestamp) <= ? AND d IS NOT NULL GROUP BY d ORDER BY d
```

Synthetic bindings: `["2026-01-01", "2026-12-31"]`. Observed binding method: synthetic.

```text
9 / 0: SCAN m
20 / 0: SEARCH s USING COVERING INDEX sqlite_autoindex_sessions_1 (id=?)
24 / 0: USE TEMP B-TREE FOR GROUP BY
```

Result rows: **107**. Three runs, median **1.062 ms**, range **1.018–1.227 ms**; ordered outputs stable.

### segments-raw-range-diagnostic

Migration test shape ONLY, compare plan to actual day buckets, not runtime performance.

```sql
SELECT session_id, total_tokens FROM session_segments WHERE end_timestamp >= ?1 AND end_timestamp < ?2
```

Synthetic bindings: `["2026-01-01", "2027-01-01"]`. Observed binding method: synthetic.

```text
3 / 0: SEARCH session_segments USING INDEX idx_session_segments_end_ts (end_timestamp>? AND end_timestamp<?)
```

Result rows: **715**. Three runs, median **1.020 ms**, range **1.014–1.258 ms**; ordered outputs stable.

## Writer, freshness and maintenance shapes — EXPLAIN only

**23 additional shapes** were prepared using EXPLAIN QUERY PLAN on a read-only/query-only connection with foreign keys enabled. Mutation statements were not executed and have no timings, changed-row counts or correctness acceptance here. SQL below is the statement being explained; synthetic parameters are public fixtures. Trigger/FK subprogram costs and transaction/FTS behavior require separate execution evidence.

### session-identity

```sql
SELECT source FROM sessions WHERE id = ?
```

Synthetic bindings: `["synthetic-session"]`.

```text
3 / 0: SEARCH sessions USING INDEX sqlite_autoindex_sessions_1 (id=?)
```

### metadata-freshness

```sql
SELECT source_fingerprint, analytics_version FROM sessions WHERE id = ?
```

Synthetic bindings: `["synthetic-session"]`.

```text
3 / 0: SEARCH sessions USING INDEX sqlite_autoindex_sessions_1 (id=?)
```

### search-freshness

```sql
SELECT CASE WHEN search_indexed_at IS NULL THEN NULL ELSE search_source_fingerprint END, search_extractor_version FROM sessions WHERE id = ?
```

Synthetic bindings: `["synthetic-session"]`.

```text
3 / 0: SEARCH sessions USING INDEX sqlite_autoindex_sessions_1 (id=?)
```

### max-content-id

```sql
SELECT MAX(id) FROM search_content
```

Synthetic bindings: `[]`.

```text
3 / 0: SEARCH search_content
```

### session-delete

```sql
DELETE FROM sessions WHERE source = ? AND id IN (SELECT value FROM json_each(?))
```

Synthetic bindings: `["copilot", "[\"synthetic-session\"]"]`.

```text
4 / 0: SEARCH sessions USING INDEX idx_sessions_source (source=?)
14 / 0: LIST SUBQUERY 1
16 / 14: SCAN json_each VIRTUAL TABLE INDEX 1:
49 / 0: SEARCH session_format_observations USING COVERING INDEX sqlite_autoindex_session_format_observations_1 (session_id=?)
56 / 0: SEARCH session_native_tool_calls USING COVERING INDEX sqlite_autoindex_session_native_tool_calls_1 (session_id=?)
63 / 0: SEARCH session_skill_invocations USING COVERING INDEX sqlite_autoindex_session_skill_invocations_1 (session_id=?)
70 / 0: SEARCH session_agent_selections USING COVERING INDEX sqlite_autoindex_session_agent_selections_1 (session_id=?)
77 / 0: SEARCH session_agent_runs USING COVERING INDEX sqlite_autoindex_session_agent_runs_1 (session_id=?)
84 / 0: SEARCH session_cache_ttls USING COVERING INDEX sqlite_autoindex_session_cache_ttls_1 (session_id=?)
91 / 0: SEARCH session_cache_windows USING COVERING INDEX sqlite_autoindex_session_cache_windows_1 (session_id=?)
98 / 0: SEARCH search_content USING COVERING INDEX idx_search_content_session_event (session_id=?)
105 / 0: SEARCH session_segments USING COVERING INDEX sqlite_autoindex_session_segments_1 (session_id=?)
112 / 0: SEARCH session_incidents USING COVERING INDEX idx_session_incidents_session (session_id=?)
119 / 0: SEARCH session_activity USING COVERING INDEX sqlite_autoindex_session_activity_1 (session_id=?)
126 / 0: SEARCH session_modified_files USING COVERING INDEX sqlite_autoindex_session_modified_files_1 (session_id=?)
133 / 0: SEARCH session_tool_calls USING COVERING INDEX sqlite_autoindex_session_tool_calls_1 (session_id=?)
140 / 0: SEARCH session_model_metrics USING COVERING INDEX sqlite_autoindex_session_model_metrics_1 (session_id=?)
```

### fts-insert-select

```sql
INSERT INTO search_fts(rowid,content) SELECT id,content FROM search_content WHERE id > ?
```

Synthetic bindings: `[0]`.

```text
3 / 0: SEARCH search_content USING INTEGER PRIMARY KEY (rowid>?)
```

### metadata-marker

```sql
UPDATE sessions SET search_indexed_at = datetime('now'), search_extractor_version = ?,search_source_fingerprint = ? WHERE id = ?
```

Synthetic bindings: `[4, "synthetic-fingerprint", "synthetic-session"]`.

```text
5 / 0: SEARCH sessions USING INDEX sqlite_autoindex_sessions_1 (id=?)
```

### migration-latest

```sql
SELECT COALESCE(MAX(version),0) FROM schema_version
```

Synthetic bindings: `[]`.

```text
3 / 0: SEARCH schema_version
```

### maintenance-read

```sql
SELECT value FROM maintenance_state WHERE key = ?
```

Synthetic bindings: `["last_maintenance"]`.

```text
3 / 0: SEARCH maintenance_state USING INDEX sqlite_autoindex_maintenance_state_1 (key=?)
```

### search_content-replace-delete

```sql
DELETE FROM "search_content" WHERE session_id = ?
```

Synthetic bindings: `["synthetic-session"]`.

```text
3 / 0: SEARCH search_content USING COVERING INDEX idx_search_content_session_event (session_id=?)
```

### session_activity-replace-delete

```sql
DELETE FROM "session_activity" WHERE session_id = ?
```

Synthetic bindings: `["synthetic-session"]`.

```text
3 / 0: SEARCH session_activity USING COVERING INDEX sqlite_autoindex_session_activity_1 (session_id=?)
```

### session_agent_runs-replace-delete

```sql
DELETE FROM "session_agent_runs" WHERE session_id = ?
```

Synthetic bindings: `["synthetic-session"]`.

```text
3 / 0: SEARCH session_agent_runs USING COVERING INDEX sqlite_autoindex_session_agent_runs_1 (session_id=?)
```

### session_agent_selections-replace-delete

```sql
DELETE FROM "session_agent_selections" WHERE session_id = ?
```

Synthetic bindings: `["synthetic-session"]`.

```text
3 / 0: SEARCH session_agent_selections USING COVERING INDEX sqlite_autoindex_session_agent_selections_1 (session_id=?)
```

### session_cache_ttls-replace-delete

```sql
DELETE FROM "session_cache_ttls" WHERE session_id = ?
```

Synthetic bindings: `["synthetic-session"]`.

```text
3 / 0: SEARCH session_cache_ttls USING COVERING INDEX sqlite_autoindex_session_cache_ttls_1 (session_id=?)
```

### session_cache_windows-replace-delete

```sql
DELETE FROM "session_cache_windows" WHERE session_id = ?
```

Synthetic bindings: `["synthetic-session"]`.

```text
3 / 0: SEARCH session_cache_windows USING COVERING INDEX sqlite_autoindex_session_cache_windows_1 (session_id=?)
```

### session_format_observations-replace-delete

```sql
DELETE FROM "session_format_observations" WHERE session_id = ?
```

Synthetic bindings: `["synthetic-session"]`.

```text
3 / 0: SEARCH session_format_observations USING COVERING INDEX sqlite_autoindex_session_format_observations_1 (session_id=?)
```

### session_incidents-replace-delete

```sql
DELETE FROM "session_incidents" WHERE session_id = ?
```

Synthetic bindings: `["synthetic-session"]`.

```text
3 / 0: SEARCH session_incidents USING COVERING INDEX idx_session_incidents_session (session_id=?)
```

### session_model_metrics-replace-delete

```sql
DELETE FROM "session_model_metrics" WHERE session_id = ?
```

Synthetic bindings: `["synthetic-session"]`.

```text
3 / 0: SEARCH session_model_metrics USING COVERING INDEX sqlite_autoindex_session_model_metrics_1 (session_id=?)
```

### session_modified_files-replace-delete

```sql
DELETE FROM "session_modified_files" WHERE session_id = ?
```

Synthetic bindings: `["synthetic-session"]`.

```text
3 / 0: SEARCH session_modified_files USING COVERING INDEX sqlite_autoindex_session_modified_files_1 (session_id=?)
```

### session_native_tool_calls-replace-delete

```sql
DELETE FROM "session_native_tool_calls" WHERE session_id = ?
```

Synthetic bindings: `["synthetic-session"]`.

```text
3 / 0: SEARCH session_native_tool_calls USING COVERING INDEX sqlite_autoindex_session_native_tool_calls_1 (session_id=?)
```

### session_segments-replace-delete

```sql
DELETE FROM "session_segments" WHERE session_id = ?
```

Synthetic bindings: `["synthetic-session"]`.

```text
3 / 0: SEARCH session_segments USING COVERING INDEX sqlite_autoindex_session_segments_1 (session_id=?)
```

### session_skill_invocations-replace-delete

```sql
DELETE FROM "session_skill_invocations" WHERE session_id = ?
```

Synthetic bindings: `["synthetic-session"]`.

```text
3 / 0: SEARCH session_skill_invocations USING COVERING INDEX sqlite_autoindex_session_skill_invocations_1 (session_id=?)
```

### session_tool_calls-replace-delete

```sql
DELETE FROM "session_tool_calls" WHERE session_id = ?
```

Synthetic bindings: `["synthetic-session"]`.

```text
3 / 0: SEARCH session_tool_calls USING COVERING INDEX sqlite_autoindex_session_tool_calls_1 (session_id=?)
```
