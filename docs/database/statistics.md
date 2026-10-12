# Every-table and every-column measurements

All counts are exact unless a cell explicitly says unavailable. N/A percentages mean a zero denominator, not zero percent. `D` excludes NULL; peak is the largest non-NULL value frequency without disclosing the value. Types list NULL/integer/real/text/BLOB counts. Text lengths use SQLite characters; BLOB lengths use bytes. The byte total counts only text/BLOB values and excludes record headers, numeric serial encodings, indexes and page overhead. Numeric min/max/mean are withheld for identifiers and absolute epoch timestamps. These are contents of one installation, not product-wide feature usage.

[Schema/constraints](schema.md) · [Physical storage](storage.md) · [Meaning and lifecycle](README.md)

## `maintenance_state`

Exact rows: **1**.

| Column | NULL (% rows) | Non-NULL | D / method | Peak frequency | Empty text / numeric zero | Types N/I/R/T/B |
| --- | --- | --- | --- | --- | --- | --- |
| `key` | 0 (0%) | 1 | 1 / exact | 1 | 0 / 0 | 0/0/0/1/0 |
| `value` | 0 (0%) | 1 | 1 / exact | 1 | 0 / 0 | 0/0/0/1/0 |

| Column | Numeric min / max / mean | Negative / positive counts | Text/BLOB length min / max / mean | Text/BLOB bytes |
| --- | --- | --- | --- | --- |
| `key` | N/A / N/A / N/A | 0 / 0 | 14 / 14 / 14 | 14 |
| `value` | N/A / N/A / N/A | 0 / 0 | 10 / 10 / 10 | 10 |

Implicit rowid: 1 non-NULL integers, 0 NULL, 1 distinct, 0 zero, 0 negative (exact). Alias: none. Range withheld; text/BLOB lengths and empty strings are inapplicable.

## `schema_version`

Exact rows: **24**.

| Column | NULL (% rows) | Non-NULL | D / method | Peak frequency | Empty text / numeric zero | Types N/I/R/T/B |
| --- | --- | --- | --- | --- | --- | --- |
| `version` | 0 (0%) | 24 | 24 / exact | 1 | 0 / 0 | 0/24/0/0/0 |
| `applied_at` | 0 (0%) | 24 | 6 / exact | 18 | 0 / 0 | 0/0/0/24/0 |

| Column | Numeric min / max / mean | Negative / positive counts | Text/BLOB length min / max / mean | Text/BLOB bytes |
| --- | --- | --- | --- | --- |
| `version` | 1 / 25 / 13.042 | 0 / 24 | N/A / N/A / N/A | 0 |
| `applied_at` | N/A / N/A / N/A | 0 / 0 | 19 / 19 / 19 | 456 |

Implicit rowid: 24 non-NULL integers, 0 NULL, 24 distinct, 0 zero, 0 negative (exact). Alias: none. Range withheld; text/BLOB lengths and empty strings are inapplicable.

## `search_content`

Exact rows: **679,345**.

| Column | NULL (% rows) | Non-NULL | D / method | Peak frequency | Empty text / numeric zero | Types N/I/R/T/B |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | 0 (0%) | 679,345 | 679,345 / exact | 1 | 0 / 0 | 0/679,345/0/0/0 |
| `session_id` | 0 (0%) | 679,345 | 510 / exact | 22,761 | 0 / 0 | 0/0/0/679,345/0 |
| `content_type` | 0 (0%) | 679,345 | 10 / exact | 293,304 | 0 / 0 | 0/0/0/679,345/0 |
| `turn_number` | 50 (0.007%) | 679,295 | 3,095 / exact | 9,939 | 0 / 6,098 | 50/679,295/0/0/0 |
| `event_index` | 0 (0%) | 679,345 | 30,009 / exact | 407 | 0 / 0 | 0/679,345/0/0/0 |
| `timestamp_unix` | 0 (0%) | 679,345 | 229,675 / exact | 86 | 0 / 0 | 0/679,345/0/0/0 |
| `tool_name` | 115,254 (16.965%) | 564,091 | 81 / exact | 213,579 | 0 / 0 | 115,254/0/0/564,091/0 |
| `content` | 0 (0%) | 679,345 | 499,074 / exact | 5,382 | 0 / 0 | 0/0/0/679,345/0 |
| `metadata_json` | 613,555 (90.316%) | 65,790 | 84 / exact | 47,822 | 0 / 0 | 613,555/0/0/65,790/0 |

| Column | Numeric min / max / mean | Negative / positive counts | Text/BLOB length min / max / mean | Text/BLOB bytes |
| --- | --- | --- | --- | --- |
| `id` | withheld (identity/epoch) | 0 / 679,345 | N/A / N/A / N/A | 0 |
| `session_id` | withheld (identity/epoch) | 0 / 0 | 36 / 36 / 36 | 24,456,420 |
| `content_type` | N/A / N/A / N/A | 0 / 0 | 5 / 18 / 10.572 | 7,181,721 |
| `turn_number` | 0 / 3,094 / 242.366 | 0 / 673,197 | N/A / N/A / N/A | 0 |
| `event_index` | 1 / 35,029 / 4,115.157 | 0 / 679,345 | N/A / N/A / N/A | 0 |
| `timestamp_unix` | withheld (identity/epoch) | 0 / 679,345 | N/A / N/A / N/A | 0 |
| `tool_name` | N/A / N/A / N/A | 0 / 0 | 2 / 42 / 5.985 | 3,376,254 |
| `content` | N/A / N/A / N/A | 0 / 0 | 1 / 24,811 / 359.954 | 245,907,291 |
| `metadata_json` | N/A / N/A / N/A | 0 / 0 | 16 / 63 / 25.418 | 1,672,254 |

Implicit rowid: 679,345 non-NULL integers, 0 NULL, 679,345 distinct, 0 zero, 0 negative (exact). Alias: id. Range withheld; text/BLOB lengths and empty strings are inapplicable.

### Provider populations

Counts include SQL NULLs, not JSON null strings. Non-NULL for any cell is provider rows minus its NULL count. Columns with no NULLs in any provider are omitted here only; their complete overall statistics remain above.

| Provider | Rows |
| --- | --- |
| claudeCode | 73,928 |
| copilot | 605,417 |

| Nullable column | claudeCode NULL | copilot NULL |
| --- | --- | --- |
| `turn_number` | 3 | 47 |
| `tool_name` | 9,624 | 105,630 |
| `metadata_json` | 9,624 | 603,931 |

## `search_fts`

Exact rows: **679,345**.

| Column | NULL (% rows) | Non-NULL | D / method | Peak frequency | Empty text / numeric zero | Types N/I/R/T/B |
| --- | --- | --- | --- | --- | --- | --- |
| `content` | 0 (0%) | 679,345 | 499,074 / exact | 5,382 | 0 / 0 | 0/0/0/679,345/0 |
| `search_fts` | 0 (0%) | 679,345 | 1 / exact | 679,345 | 0 / 0 | 0/679,345/0/0/0 |
| `rank` | 679,345 (100%) | 0 | 0 / exact | 0 | 0 / 0 | 679,345/0/0/0/0 |

| Column | Numeric min / max / mean | Negative / positive counts | Text/BLOB length min / max / mean | Text/BLOB bytes |
| --- | --- | --- | --- | --- |
| `content` | N/A / N/A / N/A | 0 / 0 | 1 / 24,811 / 359.954 | 245,907,291 |
| `search_fts` | 2 / 2 / 2 | 0 / 679,345 | N/A / N/A / N/A | 0 |
| `rank` | N/A / N/A / N/A | 0 / 0 | N/A / N/A / N/A | 0 |

Implicit rowid: 679,345 non-NULL integers, 0 NULL, 679,345 distinct, 0 zero, 0 negative (exact). Alias: none. Range withheld; text/BLOB lengths and empty strings are inapplicable.

## `search_fts_config`

Exact rows: **2**.

| Column | NULL (% rows) | Non-NULL | D / method | Peak frequency | Empty text / numeric zero | Types N/I/R/T/B |
| --- | --- | --- | --- | --- | --- | --- |
| `k` | 0 (0%) | 2 | 2 / exact | 1 | 0 / 0 | 0/0/0/2/0 |
| `v` | 0 (0%) | 2 | 2 / exact | 1 | 0 / 0 | 0/2/0/0/0 |

| Column | Numeric min / max / mean | Negative / positive counts | Text/BLOB length min / max / mean | Text/BLOB bytes |
| --- | --- | --- | --- | --- |
| `k` | N/A / N/A / N/A | 0 / 0 | 7 / 9 / 8 | 16 |
| `v` | 4 / 8 / 6 | 0 / 2 | N/A / N/A / N/A | 0 |

## `search_fts_data`

Exact rows: **21,946**.

| Column | NULL (% rows) | Non-NULL | D / method | Peak frequency | Empty text / numeric zero | Types N/I/R/T/B |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | 0 (0%) | 21,946 | 21,946 / exact | 1 | 0 / 0 | 0/21,946/0/0/0 |
| `block` | 0 (0%) | 21,946 | 21,946 / exact | 1 | 0 / 0 | 0/0/0/0/21,946 |

| Column | Numeric min / max / mean | Negative / positive counts | Text/BLOB length min / max / mean | Text/BLOB bytes |
| --- | --- | --- | --- | --- |
| `id` | withheld (identity/epoch) | 0 / 21,946 | N/A / N/A / N/A | 0 |
| `block` | N/A / N/A / N/A | 0 / 0 | 7 / 4,053 / 3,917.491 | 85,973,255 |

Implicit rowid: 21,946 non-NULL integers, 0 NULL, 21,946 distinct, 0 zero, 0 negative (exact). Alias: id. Range withheld; text/BLOB lengths and empty strings are inapplicable.

## `search_fts_docsize`

Exact rows: **679,345**.

| Column | NULL (% rows) | Non-NULL | D / method | Peak frequency | Empty text / numeric zero | Types N/I/R/T/B |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | 0 (0%) | 679,345 | 679,345 / exact | 1 | 0 / 0 | 0/679,345/0/0/0 |
| `sz` | 0 (0%) | 679,345 | 896 / exact | 33,618 | 0 / 0 | 0/0/0/0/679,345 |

| Column | Numeric min / max / mean | Negative / positive counts | Text/BLOB length min / max / mean | Text/BLOB bytes |
| --- | --- | --- | --- | --- |
| `id` | withheld (identity/epoch) | 0 / 679,345 | N/A / N/A / N/A | 0 |
| `sz` | N/A / N/A / N/A | 0 / 0 | 1 / 2 / 1.065 | 723,650 |

Implicit rowid: 679,345 non-NULL integers, 0 NULL, 679,345 distinct, 0 zero, 0 negative (exact). Alias: id. Range withheld; text/BLOB lengths and empty strings are inapplicable.

## `search_fts_idx`

Exact rows: **7,767**.

| Column | NULL (% rows) | Non-NULL | D / method | Peak frequency | Empty text / numeric zero | Types N/I/R/T/B |
| --- | --- | --- | --- | --- | --- | --- |
| `segid` | 0 (0%) | 7,767 | 7 / exact | 5,478 | 0 / 0 | 0/7,767/0/0/0 |
| `term` | 0 (0%) | 7,767 | 7,032 / exact | 7 | 0 / 0 | 0/0/0/0/7,767 |
| `pgno` | 0 (0%) | 7,767 | 6,396 / exact | 6 | 0 / 0 | 0/7,767/0/0/0 |

| Column | Numeric min / max / mean | Negative / positive counts | Text/BLOB length min / max / mean | Text/BLOB bytes |
| --- | --- | --- | --- | --- |
| `segid` | withheld (identity/epoch) | 0 / 7,767 | N/A / N/A / N/A | 0 |
| `term` | N/A / N/A / N/A | 0 / 0 | 0 / 303 / 7.607 | 59,087 |
| `pgno` | withheld (identity/epoch) | 0 / 7,767 | N/A / N/A / N/A | 0 |

## `session_activity`

Exact rows: **1,254**.

| Column | NULL (% rows) | Non-NULL | D / method | Peak frequency | Empty text / numeric zero | Types N/I/R/T/B |
| --- | --- | --- | --- | --- | --- | --- |
| `session_id` | 0 (0%) | 1,254 | 442 / exact | 27 | 0 / 0 | 0/0/0/1,254/0 |
| `day_of_week` | 0 (0%) | 1,254 | 7 / exact | 287 | 0 / 160 | 0/1,254/0/0/0 |
| `hour` | 0 (0%) | 1,254 | 21 / exact | 150 | 0 / 37 | 0/1,254/0/0/0 |
| `tool_call_count` | 0 (0%) | 1,254 | 525 / exact | 26 | 0 / 0 | 0/1,254/0/0/0 |

| Column | Numeric min / max / mean | Negative / positive counts | Text/BLOB length min / max / mean | Text/BLOB bytes |
| --- | --- | --- | --- | --- |
| `session_id` | withheld (identity/epoch) | 0 / 0 | 36 / 36 / 36 | 45,144 |
| `day_of_week` | 0 / 6 / 3.612 | 0 / 1,094 | N/A / N/A / N/A | 0 |
| `hour` | 0 / 23 / 7.369 | 0 / 1,217 | N/A / N/A / N/A | 0 |
| `tool_call_count` | 1 / 3,810 / 239.623 | 0 / 1,254 | N/A / N/A / N/A | 0 |

Implicit rowid: 1,254 non-NULL integers, 0 NULL, 1,254 distinct, 0 zero, 0 negative (exact). Alias: none. Range withheld; text/BLOB lengths and empty strings are inapplicable.

### Provider populations

Counts include SQL NULLs, not JSON null strings. Non-NULL for any cell is provider rows minus its NULL count. Columns with no NULLs in any provider are omitted here only; their complete overall statistics remain above.

| Provider | Rows |
| --- | --- |
| claudeCode | 248 |
| copilot | 1,006 |

| Nullable column | claudeCode NULL | copilot NULL |
| --- | --- | --- |

## `session_agent_runs`

Exact rows: **5,825**.

| Column | NULL (% rows) | Non-NULL | D / method | Peak frequency | Empty text / numeric zero | Types N/I/R/T/B |
| --- | --- | --- | --- | --- | --- | --- |
| `session_id` | 0 (0%) | 5,825 | 287 / exact | 169 | 0 / 0 | 0/0/0/5,825/0 |
| `run_key` | 0 (0%) | 5,825 | 5,825 / exact | 1 | 0 / 0 | 0/0/0/5,825/0 |
| `tool_call_id` | 0 (0%) | 5,825 | 5,825 / exact | 1 | 0 / 0 | 0/0/0/5,825/0 |
| `agent_id` | 2,825 (48.498%) | 3,000 | 2,459 / exact | 53 | 0 / 0 | 2,825/0/0/3,000/0 |
| `parent_run_key` | 4,235 (72.704%) | 1,590 | 944 / exact | 13 | 0 / 0 | 4,235/0/0/1,590/0 |
| `parent_agent_name` | 4,235 (72.704%) | 1,590 | 2 / exact | 1,056 | 0 / 0 | 4,235/0/0/1,590/0 |
| `depth` | 0 (0%) | 5,825 | 4 / exact | 4,235 | 0 / 4,235 | 0/5,825/0/0/0 |
| `agent_name` | 0 (0%) | 5,825 | 9 / exact | 2,419 | 0 / 0 | 0/0/0/5,825/0 |
| `agent_type` | 0 (0%) | 5,825 | 9 / exact | 2,419 | 0 / 0 | 0/0/0/5,825/0 |
| `display_name` | 4 (0.069%) | 5,821 | 68 / exact | 2,411 | 0 / 0 | 4/0/0/5,821/0 |
| `description` | 1 (0.017%) | 5,824 | 204 / exact | 2,014 | 0 / 0 | 1/0/0/5,824/0 |
| `execution_mode` | 1,324 (22.73%) | 4,501 | 2 / exact | 3,898 | 0 / 0 | 1,324/0/0/4,501/0 |
| `started_at` | 0 (0%) | 5,825 | 3,429 / exact | 34 | 0 / 0 | 0/0/0/5,825/0 |
| `ended_at` | 52 (0.893%) | 5,773 | 5,752 / exact | 4 | 0 / 0 | 52/0/0/5,773/0 |
| `outcome` | 0 (0%) | 5,825 | 4 / exact | 5,582 | 0 / 0 | 0/0/0/5,825/0 |
| `error_text` | 5,638 (96.79%) | 187 | 94 / exact | 23 | 0 / 0 | 5,638/0/0/187/0 |
| `requested_model` | 2,593 (44.515%) | 3,232 | 19 / exact | 1,129 | 0 / 0 | 2,593/0/0/3,232/0 |
| `model` | 7 (0.12%) | 5,818 | 21 / exact | 1,541 | 0 / 0 | 7/0/0/5,818/0 |
| `configured_model` | 5,807 (99.691%) | 18 | 3 / exact | 15 | 0 / 0 | 5,807/0/0/18/0 |
| `configured_effort` | 5,807 (99.691%) | 18 | 3 / exact | 9 | 0 / 0 | 5,807/0/0/18/0 |
| `context_tier` | 5,816 (99.845%) | 9 | 1 / exact | 9 | 0 / 0 | 5,816/0/0/9/0 |
| `multi_turn` | 5,807 (99.691%) | 18 | 2 / exact | 16 | 0 / 2 | 5,807/18/0/0/0 |
| `first_dispatched_model` | 5,808 (99.708%) | 17 | 1 / exact | 17 | 0 / 0 | 5,808/0/0/17/0 |
| `explicit_model_override` | 5,808 (99.708%) | 17 | 2 / exact | 15 | 0 / 0 | 5,808/0/0/17/0 |
| `model_override_reason` | 5,825 (100%) | 0 | 0 / exact | 0 | 0 / 0 | 5,825/0/0/0/0 |
| `configured_model_preference` | 5,825 (100%) | 0 | 0 / exact | 0 | 0 / 0 | 5,825/0/0/0/0 |
| `configured_matches_actual` | 5,825 (100%) | 0 | 0 / exact | 0 | 0 / 0 | 5,825/0/0/0/0 |
| `total_tool_calls` | 3,776 (64.824%) | 2,049 | 157 / exact | 63 | 0 / 27 | 3,776/2,049/0/0/0 |
| `total_tokens` | 3,784 (64.961%) | 2,041 | 2,040 / exact | 2 | 0 / 0 | 3,784/2,041/0/0/0 |
| `duration_ms` | 52 (0.893%) | 5,773 | 5,712 / exact | 4 | 0 / 1 | 52/5,773/0/0/0 |
| `own_nano_aiu` | 5,807 (99.691%) | 18 | 18 / exact | 1 | 0 / 1 | 5,807/18/0/0/0 |
| `follow_up_count` | 0 (0%) | 5,825 | 8 / exact | 5,776 | 0 / 5,776 | 0/5,825/0/0/0 |
| `peak_siblings` | 0 (0%) | 5,825 | 35 / exact | 1,955 | 0 / 0 | 0/5,825/0/0/0 |
| `turn_index` | 0 (0%) | 5,825 | 720 / exact | 198 | 0 / 148 | 0/5,825/0/0/0 |
| `event_index` | 0 (0%) | 5,825 | 3,809 / exact | 40 | 0 / 0 | 0/5,825/0/0/0 |
| `source` | 0 (0%) | 5,825 | 2 / exact | 5,779 | 0 / 0 | 0/0/0/5,825/0 |
| `messages_sent` | 0 (0%) | 5,825 | 5 / exact | 5,820 | 0 / 5,820 | 0/5,825/0/0/0 |
| `messages_received` | 0 (0%) | 5,825 | 5 / exact | 5,820 | 0 / 5,820 | 0/5,825/0/0/0 |
| `peer_messages` | 0 (0%) | 5,825 | 3 / exact | 5,821 | 0 / 5,821 | 0/5,825/0/0/0 |
| `queued_messages` | 0 (0%) | 5,825 | 4 / exact | 5,822 | 0 / 5,822 | 0/5,825/0/0/0 |

| Column | Numeric min / max / mean | Negative / positive counts | Text/BLOB length min / max / mean | Text/BLOB bytes |
| --- | --- | --- | --- | --- |
| `session_id` | withheld (identity/epoch) | 0 / 0 | 36 / 36 / 36 | 209,700 |
| `run_key` | N/A / N/A / N/A | 0 / 0 | 29 / 35 / 29.946 | 174,433 |
| `tool_call_id` | withheld (identity/epoch) | 0 / 0 | 29 / 35 / 29.946 | 174,433 |
| `agent_id` | withheld (identity/epoch) | 0 / 0 | 6 / 36 / 17.456 | 52,369 |
| `parent_run_key` | N/A / N/A / N/A | 0 / 0 | 29 / 35 / 29.91 | 47,557 |
| `parent_agent_name` | N/A / N/A / N/A | 0 / 0 | 11 / 15 / 13.657 | 21,714 |
| `depth` | 0 / 3 / 0.301 | 0 / 1,590 | N/A / N/A / N/A | 0 |
| `agent_name` | N/A / N/A / N/A | 0 / 0 | 4 / 15 / 10.734 | 62,523 |
| `agent_type` | N/A / N/A / N/A | 0 / 0 | 4 / 15 / 10.734 | 62,523 |
| `display_name` | N/A / N/A / N/A | 0 / 0 | 4 / 24 / 16.546 | 96,312 |
| `description` | N/A / N/A / N/A | 0 / 0 | 13 / 598 / 219.508 | 1,278,450 |
| `execution_mode` | N/A / N/A / N/A | 0 / 0 | 4 / 10 / 9.196 | 41,392 |
| `started_at` | N/A / N/A / N/A | 0 / 0 | 29 / 29 / 29 | 168,925 |
| `ended_at` | N/A / N/A / N/A | 0 / 0 | 25 / 29 / 28.995 | 167,389 |
| `outcome` | N/A / N/A / N/A | 0 / 0 | 6 / 10 / 8.913 | 51,916 |
| `error_text` | N/A / N/A / N/A | 0 / 0 | 21 / 413 / 183.032 | 34,229 |
| `requested_model` | N/A / N/A / N/A | 0 / 0 | 4 / 20 / 13.775 | 44,522 |
| `model` | N/A / N/A / N/A | 0 / 0 | 7 / 20 / 13.451 | 78,257 |
| `configured_model` | N/A / N/A / N/A | 0 / 0 | 12 / 16 / 12.667 | 228 |
| `configured_effort` | N/A / N/A / N/A | 0 / 0 | 3 / 4 / 3.556 | 64 |
| `context_tier` | N/A / N/A / N/A | 0 / 0 | 12 / 12 / 12 | 108 |
| `multi_turn` | 0 / 1 / 0.889 | 0 / 16 | N/A / N/A / N/A | 0 |
| `first_dispatched_model` | N/A / N/A / N/A | 0 / 0 | 12 / 12 / 12 | 204 |
| `explicit_model_override` | N/A / N/A / N/A | 0 / 0 | 12 / 16 / 12.471 | 212 |
| `model_override_reason` | N/A / N/A / N/A | 0 / 0 | N/A / N/A / N/A | 0 |
| `configured_model_preference` | N/A / N/A / N/A | 0 / 0 | N/A / N/A / N/A | 0 |
| `configured_matches_actual` | N/A / N/A / N/A | 0 / 0 | N/A / N/A / N/A | 0 |
| `total_tool_calls` | 0 / 283 / 34.239 | 0 / 2,022 | N/A / N/A / N/A | 0 |
| `total_tokens` | 4,524 / 17,051,728 / 722,963.539 | 0 / 2,041 | N/A / N/A / N/A | 0 |
| `duration_ms` | 0 / 13,645,221 / 300,715.893 | 0 / 5,772 | N/A / N/A / N/A | 0 |
| `own_nano_aiu` | 0 / 8,032,415,000 / 2,900,853,500 | 0 / 17 | N/A / N/A / N/A | 0 |
| `follow_up_count` | 0 / 13 / 0.017 | 0 / 49 | N/A / N/A / N/A | 0 |
| `peak_siblings` | 1 / 62 / 6.075 | 0 / 5,825 | N/A / N/A / N/A | 0 |
| `turn_index` | 0 / 2,947 / 181.838 | 0 / 5,677 | N/A / N/A / N/A | 0 |
| `event_index` | 5 / 33,612 / 3,367.87 | 0 / 5,825 | N/A / N/A / N/A | 0 |
| `source` | N/A / N/A / N/A | 0 / 0 | 6 / 9 / 6.024 | 35,088 |
| `messages_sent` | 0 / 9 / 0.004 | 0 / 5 | N/A / N/A / N/A | 0 |
| `messages_received` | 0 / 10 / 0.004 | 0 / 5 | N/A / N/A / N/A | 0 |
| `peer_messages` | 0 / 17 / 0.007 | 0 / 4 | N/A / N/A / N/A | 0 |
| `queued_messages` | 0 / 8 / 0.003 | 0 / 3 | N/A / N/A / N/A | 0 |

Implicit rowid: 5,825 non-NULL integers, 0 NULL, 5,825 distinct, 0 zero, 0 negative (exact). Alias: none. Range withheld; text/BLOB lengths and empty strings are inapplicable.

### Provider populations

Counts include SQL NULLs, not JSON null strings. Non-NULL for any cell is provider rows minus its NULL count. Columns with no NULLs in any provider are omitted here only; their complete overall statistics remain above.

| Provider | Rows |
| --- | --- |
| claudeCode | 139 |
| copilot | 5,686 |

| Nullable column | claudeCode NULL | copilot NULL |
| --- | --- | --- |
| `agent_id` | 0 | 2,825 |
| `parent_run_key` | 137 | 4,098 |
| `parent_agent_name` | 137 | 4,098 |
| `display_name` | 0 | 4 |
| `description` | 0 | 1 |
| `execution_mode` | 28 | 1,296 |
| `ended_at` | 0 | 52 |
| `error_text` | 137 | 5,501 |
| `requested_model` | 135 | 2,458 |
| `model` | 0 | 7 |
| `configured_model` | 139 | 5,668 |
| `configured_effort` | 139 | 5,668 |
| `context_tier` | 139 | 5,677 |
| `multi_turn` | 139 | 5,668 |
| `first_dispatched_model` | 139 | 5,669 |
| `explicit_model_override` | 139 | 5,669 |
| `model_override_reason` | 139 | 5,686 |
| `configured_model_preference` | 139 | 5,686 |
| `configured_matches_actual` | 139 | 5,686 |
| `total_tool_calls` | 4 | 3,772 |
| `total_tokens` | 4 | 3,780 |
| `duration_ms` | 0 | 52 |
| `own_nano_aiu` | 139 | 5,668 |

## `session_agent_selections`

Exact rows: **0**.

| Column | NULL (% rows) | Non-NULL | D / method | Peak frequency | Empty text / numeric zero | Types N/I/R/T/B |
| --- | --- | --- | --- | --- | --- | --- |
| `session_id` | 0 (N/A%) | 0 | 0 / exact | 0 | 0 / 0 | 0/0/0/0/0 |
| `event_index` | 0 (N/A%) | 0 | 0 / exact | 0 | 0 / 0 | 0/0/0/0/0 |
| `agent_name` | 0 (N/A%) | 0 | 0 / exact | 0 | 0 / 0 | 0/0/0/0/0 |
| `display_name` | 0 (N/A%) | 0 | 0 / exact | 0 | 0 / 0 | 0/0/0/0/0 |
| `selected` | 0 (N/A%) | 0 | 0 / exact | 0 | 0 / 0 | 0/0/0/0/0 |
| `timestamp` | 0 (N/A%) | 0 | 0 / exact | 0 | 0 / 0 | 0/0/0/0/0 |

| Column | Numeric min / max / mean | Negative / positive counts | Text/BLOB length min / max / mean | Text/BLOB bytes |
| --- | --- | --- | --- | --- |
| `session_id` | withheld (identity/epoch) | 0 / 0 | N/A / N/A / N/A | 0 |
| `event_index` | N/A / N/A / N/A | 0 / 0 | N/A / N/A / N/A | 0 |
| `agent_name` | N/A / N/A / N/A | 0 / 0 | N/A / N/A / N/A | 0 |
| `display_name` | N/A / N/A / N/A | 0 / 0 | N/A / N/A / N/A | 0 |
| `selected` | N/A / N/A / N/A | 0 / 0 | N/A / N/A / N/A | 0 |
| `timestamp` | N/A / N/A / N/A | 0 / 0 | N/A / N/A / N/A | 0 |

Implicit rowid: 0 non-NULL integers, 0 NULL, 0 distinct, 0 zero, 0 negative (exact). Alias: none. Range withheld; text/BLOB lengths and empty strings are inapplicable.

## `session_cache_ttls`

Exact rows: **30**.

| Column | NULL (% rows) | Non-NULL | D / method | Peak frequency | Empty text / numeric zero | Types N/I/R/T/B |
| --- | --- | --- | --- | --- | --- | --- |
| `session_id` | 0 (0%) | 30 | 29 / exact | 2 | 0 / 0 | 0/0/0/30/0 |
| `model` | 0 (0%) | 30 | 3 / exact | 25 | 0 / 0 | 0/0/0/30/0 |
| `ttl_seconds` | 0 (0%) | 30 | 2 / exact | 29 | 0 / 0 | 0/30/0/0/0 |
| `observation_count` | 0 (0%) | 30 | 6 / exact | 17 | 0 / 0 | 0/30/0/0/0 |

| Column | Numeric min / max / mean | Negative / positive counts | Text/BLOB length min / max / mean | Text/BLOB bytes |
| --- | --- | --- | --- | --- |
| `session_id` | withheld (identity/epoch) | 0 / 0 | 36 / 36 / 36 | 1,080 |
| `model` | N/A / N/A / N/A | 0 / 0 | 10 / 18 / 12.733 | 382 |
| `ttl_seconds` | 1,800 / 86,400 / 4,620 | 0 / 30 | N/A / N/A / N/A | 0 |
| `observation_count` | 1 / 6 / 1.9 | 0 / 30 | N/A / N/A / N/A | 0 |

Implicit rowid: 30 non-NULL integers, 0 NULL, 30 distinct, 0 zero, 0 negative (exact). Alias: none. Range withheld; text/BLOB lengths and empty strings are inapplicable.

### Provider populations

Counts include SQL NULLs, not JSON null strings. Non-NULL for any cell is provider rows minus its NULL count. Columns with no NULLs in any provider are omitted here only; their complete overall statistics remain above.

| Provider | Rows |
| --- | --- |
| copilot | 30 |

| Nullable column | copilot NULL |
| --- | --- |

## `session_cache_windows`

Exact rows: **531**.

| Column | NULL (% rows) | Non-NULL | D / method | Peak frequency | Empty text / numeric zero | Types N/I/R/T/B |
| --- | --- | --- | --- | --- | --- | --- |
| `session_id` | 0 (0%) | 531 | 133 / exact | 24 | 0 / 0 | 0/0/0/531/0 |
| `window_index` | 0 (0%) | 531 | 24 / exact | 131 | 0 / 131 | 0/531/0/0/0 |
| `idle_start` | 0 (0%) | 531 | 531 / exact | 1 | 0 / 0 | 0/0/0/531/0 |
| `resume_at` | 133 (25.047%) | 398 | 398 / exact | 1 | 0 / 0 | 133/0/0/398/0 |
| `idle_seconds` | 133 (25.047%) | 398 | 268 / exact | 6 | 0 / 0 | 133/398/0/0/0 |
| `model` | 0 (0%) | 531 | 5 / exact | 449 | 0 / 0 | 0/0/0/531/0 |
| `expires_at` | 1 (0.188%) | 530 | 530 / exact | 1 | 0 / 0 | 1/0/0/530/0 |
| `ttl_seconds` | 1 (0.188%) | 530 | 3 / exact | 474 | 0 / 0 | 1/530/0/0/0 |
| `outcome` | 0 (0%) | 531 | 5 / exact | 393 | 0 / 0 | 0/0/0/531/0 |
| `resume_source` | 379 (71.375%) | 152 | 3 / exact | 130 | 0 / 0 | 379/0/0/152/0 |
| `prefix_tokens` | 12 (2.26%) | 519 | 519 / exact | 1 | 0 / 0 | 12/519/0/0/0 |
| `interaction_nano_aiu` | 503 (94.727%) | 28 | 28 / exact | 1 | 0 / 0 | 503/28/0/0/0 |
| `change_kinds` | 524 (98.682%) | 7 | 7 / exact | 1 | 0 / 0 | 524/0/0/7/0 |

| Column | Numeric min / max / mean | Negative / positive counts | Text/BLOB length min / max / mean | Text/BLOB bytes |
| --- | --- | --- | --- | --- |
| `session_id` | withheld (identity/epoch) | 0 / 0 | 36 / 36 / 36 | 19,116 |
| `window_index` | 0 / 23 / 3.284 | 0 / 400 | N/A / N/A / N/A | 0 |
| `idle_start` | N/A / N/A / N/A | 0 / 0 | 24 / 24 / 24 | 12,744 |
| `resume_at` | N/A / N/A / N/A | 0 / 0 | 24 / 24 / 24 | 9,552 |
| `idle_seconds` | 3 / 605,339 / 2,204.58 | 0 / 398 | N/A / N/A / N/A | 0 |
| `model` | N/A / N/A / N/A | 0 / 0 | 10 / 18 / 14.659 | 7,784 |
| `expires_at` | N/A / N/A / N/A | 0 / 0 | 24 / 24 / 24 | 12,720 |
| `ttl_seconds` | 1,800 / 86,400 / 3,569.434 | 0 / 530 | N/A / N/A / N/A | 0 |
| `outcome` | N/A / N/A / N/A | 0 / 0 | 4 / 12 / 5.043 | 2,678 |
| `resume_source` | N/A / N/A / N/A | 0 / 0 | 5 / 15 / 6.974 | 1,060 |
| `prefix_tokens` | 1,280 / 626,266 / 223,652.295 | 0 / 519 | N/A / N/A / N/A | 0 |
| `interaction_nano_aiu` | 19,898,000 / 16,875,800,000 / 1,510,151,353.571 | 0 / 28 | N/A / N/A / N/A | 0 |
| `change_kinds` | N/A / N/A / N/A | 0 / 0 | 5 / 25 / 12 | 84 |

Implicit rowid: 531 non-NULL integers, 0 NULL, 531 distinct, 0 zero, 0 negative (exact). Alias: none. Range withheld; text/BLOB lengths and empty strings are inapplicable.

### Provider populations

Counts include SQL NULLs, not JSON null strings. Non-NULL for any cell is provider rows minus its NULL count. Columns with no NULLs in any provider are omitted here only; their complete overall statistics remain above.

| Provider | Rows |
| --- | --- |
| claudeCode | 474 |
| copilot | 57 |

| Nullable column | claudeCode NULL | copilot NULL |
| --- | --- | --- |
| `resume_at` | 104 | 29 |
| `idle_seconds` | 104 | 29 |
| `expires_at` | 0 | 1 |
| `ttl_seconds` | 0 | 1 |
| `resume_source` | 327 | 52 |
| `prefix_tokens` | 0 | 12 |
| `interaction_nano_aiu` | 474 | 29 |
| `change_kinds` | 474 | 50 |

## `session_format_observations`

Exact rows: **646**.

| Column | NULL (% rows) | Non-NULL | D / method | Peak frequency | Empty text / numeric zero | Types N/I/R/T/B |
| --- | --- | --- | --- | --- | --- | --- |
| `session_id` | 0 (0%) | 646 | 518 / exact | 11 | 0 / 0 | 0/0/0/646/0 |
| `kind` | 0 (0%) | 646 | 2 / exact | 519 | 0 / 0 | 0/0/0/646/0 |
| `name` | 0 (0%) | 646 | 78 / exact | 39 | 0 / 0 | 0/0/0/646/0 |
| `record_count` | 0 (0%) | 646 | 113 / exact | 494 | 0 / 0 | 0/646/0/0/0 |

| Column | Numeric min / max / mean | Negative / positive counts | Text/BLOB length min / max / mean | Text/BLOB bytes |
| --- | --- | --- | --- | --- |
| `session_id` | withheld (identity/epoch) | 0 / 0 | 36 / 36 / 36 | 23,256 |
| `kind` | N/A / N/A / N/A | 0 / 0 | 6 / 7 / 6.803 | 4,395 |
| `name` | N/A / N/A / N/A | 0 / 0 | 5 / 33 / 8.92 | 5,762 |
| `record_count` | 1 / 11,390 / 218.63 | 0 / 646 | N/A / N/A / N/A | 0 |

Implicit rowid: 646 non-NULL integers, 0 NULL, 646 distinct, 0 zero, 0 negative (exact). Alias: none. Range withheld; text/BLOB lengths and empty strings are inapplicable.

### Provider populations

Counts include SQL NULLs, not JSON null strings. Non-NULL for any cell is provider rows minus its NULL count. Columns with no NULLs in any provider are omitted here only; their complete overall statistics remain above.

| Provider | Rows |
| --- | --- |
| claudeCode | 111 |
| copilot | 535 |

| Nullable column | claudeCode NULL | copilot NULL |
| --- | --- | --- |

## `session_incidents`

Exact rows: **1,003**.

| Column | NULL (% rows) | Non-NULL | D / method | Peak frequency | Empty text / numeric zero | Types N/I/R/T/B |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | 0 (0%) | 1,003 | 1,003 / exact | 1 | 0 / 0 | 0/1,003/0/0/0 |
| `session_id` | 0 (0%) | 1,003 | 263 / exact | 50 | 0 / 0 | 0/0/0/1,003/0 |
| `event_type` | 0 (0%) | 1,003 | 4 / exact | 763 | 0 / 0 | 0/0/0/1,003/0 |
| `source_event_type` | 0 (0%) | 1,003 | 4 / exact | 763 | 0 / 0 | 0/0/0/1,003/0 |
| `timestamp` | 0 (0%) | 1,003 | 992 / exact | 12 | 0 / 0 | 0/0/0/1,003/0 |
| `severity` | 0 (0%) | 1,003 | 3 / exact | 741 | 0 / 0 | 0/0/0/1,003/0 |
| `summary` | 0 (0%) | 1,003 | 775 / exact | 103 | 0 / 0 | 0/0/0/1,003/0 |
| `detail_json` | 0 (0%) | 1,003 | 883 / exact | 25 | 0 / 0 | 0/0/0/1,003/0 |

| Column | Numeric min / max / mean | Negative / positive counts | Text/BLOB length min / max / mean | Text/BLOB bytes |
| --- | --- | --- | --- | --- |
| `id` | withheld (identity/epoch) | 0 / 1,003 | N/A / N/A / N/A | 0 |
| `session_id` | withheld (identity/epoch) | 0 / 0 | 36 / 36 / 36 | 36,108 |
| `event_type` | N/A / N/A / N/A | 0 / 0 | 5 / 10 / 9.005 | 9,032 |
| `source_event_type` | N/A / N/A / N/A | 0 / 0 | 13 / 27 / 23.851 | 23,923 |
| `timestamp` | N/A / N/A / N/A | 0 / 0 | 25 / 29 / 28.996 | 29,083 |
| `severity` | N/A / N/A / N/A | 0 / 0 | 4 / 7 / 4.5 | 4,514 |
| `summary` | N/A / N/A / N/A | 0 / 0 | 14 / 246 / 62.071 | 62,257 |
| `detail_json` | N/A / N/A / N/A | 0 / 0 | 60 / 34,588 / 11,343.269 | 11,441,019 |

Implicit rowid: 1,003 non-NULL integers, 0 NULL, 1,003 distinct, 0 zero, 0 negative (exact). Alias: id. Range withheld; text/BLOB lengths and empty strings are inapplicable.

### Provider populations

Counts include SQL NULLs, not JSON null strings. Non-NULL for any cell is provider rows minus its NULL count. Columns with no NULLs in any provider are omitted here only; their complete overall statistics remain above.

| Provider | Rows |
| --- | --- |
| claudeCode | 147 |
| copilot | 856 |

| Nullable column | claudeCode NULL | copilot NULL |
| --- | --- | --- |

## `session_model_metrics`

Exact rows: **1,142**.

| Column | NULL (% rows) | Non-NULL | D / method | Peak frequency | Empty text / numeric zero | Types N/I/R/T/B |
| --- | --- | --- | --- | --- | --- | --- |
| `session_id` | 0 (0%) | 1,142 | 461 / exact | 8 | 0 / 0 | 0/0/0/1,142/0 |
| `model_name` | 0 (0%) | 1,142 | 25 / exact | 176 | 0 / 0 | 0/0/0/1,142/0 |
| `input_tokens` | 0 (0%) | 1,142 | 1,136 / exact | 2 | 0 / 1 | 0/1,142/0/0/0 |
| `output_tokens` | 0 (0%) | 1,142 | 1,086 / exact | 8 | 0 / 1 | 0/1,142/0/0/0 |
| `cache_read_tokens` | 0 (0%) | 1,142 | 1,028 / exact | 103 | 0 / 103 | 0/1,142/0/0/0 |
| `cache_write_tokens` | 0 (0%) | 1,142 | 181 / exact | 962 | 0 / 962 | 0/1,142/0/0/0 |
| `cost` | 191 (16.725%) | 951 | 37 / exact | 622 | 0 / 622 | 191/0/951/0/0 |
| `request_count` | 0 (0%) | 1,142 | 344 / exact | 87 | 0 / 87 | 0/1,142/0/0/0 |
| `reasoning_tokens` | 703 (61.559%) | 439 | 229 / exact | 200 | 0 / 200 | 703/439/0/0/0 |
| `total_nano_aiu` | 1,103 (96.585%) | 39 | 31 / exact | 9 | 0 / 9 | 1,103/39/0/0/0 |
| `cost_usd` | 952 (83.363%) | 190 | 187 / exact | 2 | 0 / 0 | 952/0/190/0/0 |

| Column | Numeric min / max / mean | Negative / positive counts | Text/BLOB length min / max / mean | Text/BLOB bytes |
| --- | --- | --- | --- | --- |
| `session_id` | withheld (identity/epoch) | 0 / 0 | 36 / 36 / 36 | 41,112 |
| `model_name` | N/A / N/A / N/A | 0 / 0 | 7 / 25 / 14.44 | 16,491 |
| `input_tokens` | 0 / 589,636,921 / 13,152,760.37 | 0 / 1,141 | N/A / N/A / N/A | 0 |
| `output_tokens` | 0 / 2,595,777 / 90,200.998 | 0 / 1,141 | N/A / N/A / N/A | 0 |
| `cache_read_tokens` | 0 / 569,412,375 / 12,546,455.252 | 0 / 1,039 | N/A / N/A / N/A | 0 |
| `cache_write_tokens` | 0 / 20,127,487 / 130,231.128 | 0 / 180 | N/A / N/A / N/A | 0 |
| `cost` | 0 / 120 / 3.639 | 0 / 329 | N/A / N/A / N/A | 0 |
| `request_count` | 0 / 4,051 / 143.373 | 0 / 1,055 | N/A / N/A / N/A | 0 |
| `reasoning_tokens` | 0 / 475,956 / 19,591.23 | 0 / 239 | N/A / N/A / N/A | 0 |
| `total_nano_aiu` | 0 / 188,594,945,000 / 7,806,344,076.923 | 0 / 30 | N/A / N/A / N/A | 0 |
| `cost_usd` | 0 / 245.214 / 13.398 | 0 / 190 | N/A / N/A / N/A | 0 |

Implicit rowid: 1,142 non-NULL integers, 0 NULL, 1,142 distinct, 0 zero, 0 negative (exact). Alias: none. Range withheld; text/BLOB lengths and empty strings are inapplicable.

### Provider populations

Counts include SQL NULLs, not JSON null strings. Non-NULL for any cell is provider rows minus its NULL count. Columns with no NULLs in any provider are omitted here only; their complete overall statistics remain above.

| Provider | Rows |
| --- | --- |
| claudeCode | 191 |
| copilot | 951 |

| Nullable column | claudeCode NULL | copilot NULL |
| --- | --- | --- |
| `cost` | 191 | 0 |
| `reasoning_tokens` | 1 | 702 |
| `total_nano_aiu` | 191 | 912 |
| `cost_usd` | 1 | 951 |

## `session_modified_files`

Exact rows: **5,719**.

| Column | NULL (% rows) | Non-NULL | D / method | Peak frequency | Empty text / numeric zero | Types N/I/R/T/B |
| --- | --- | --- | --- | --- | --- | --- |
| `session_id` | 0 (0%) | 5,719 | 344 / exact | 270 | 0 / 0 | 0/0/0/5,719/0 |
| `file_path` | 0 (0%) | 5,719 | 3,992 / exact | 25 | 0 / 0 | 0/0/0/5,719/0 |
| `extension` | 12 (0.21%) | 5,707 | 34 / exact | 1,280 | 0 / 0 | 12/0/0/5,707/0 |

| Column | Numeric min / max / mean | Negative / positive counts | Text/BLOB length min / max / mean | Text/BLOB bytes |
| --- | --- | --- | --- | --- |
| `session_id` | withheld (identity/epoch) | 0 / 0 | 36 / 36 / 36 | 205,884 |
| `file_path` | N/A / N/A / N/A | 0 / 0 | 23 / 181 / 75.026 | 429,073 |
| `extension` | N/A / N/A / N/A | 0 / 0 | 2 / 10 / 2.322 | 13,250 |

Implicit rowid: 5,719 non-NULL integers, 0 NULL, 5,719 distinct, 0 zero, 0 negative (exact). Alias: none. Range withheld; text/BLOB lengths and empty strings are inapplicable.

### Provider populations

Counts include SQL NULLs, not JSON null strings. Non-NULL for any cell is provider rows minus its NULL count. Columns with no NULLs in any provider are omitted here only; their complete overall statistics remain above.

| Provider | Rows |
| --- | --- |
| claudeCode | 1,896 |
| copilot | 3,823 |

| Nullable column | claudeCode NULL | copilot NULL |
| --- | --- | --- |
| `extension` | 0 | 12 |

## `session_native_tool_calls`

Exact rows: **851**.

| Column | NULL (% rows) | Non-NULL | D / method | Peak frequency | Empty text / numeric zero | Types N/I/R/T/B |
| --- | --- | --- | --- | --- | --- | --- |
| `session_id` | 0 (0%) | 851 | 104 / exact | 21 | 0 / 0 | 0/0/0/851/0 |
| `tool_name` | 0 (0%) | 851 | 44 / exact | 104 | 0 / 0 | 0/0/0/851/0 |
| `native_tool_name` | 0 (0%) | 851 | 41 / exact | 133 | 0 / 0 | 0/0/0/851/0 |
| `call_count` | 0 (0%) | 851 | 135 / exact | 248 | 0 / 0 | 0/851/0/0/0 |
| `success_count` | 0 (0%) | 851 | 138 / exact | 244 | 0 / 8 | 0/851/0/0/0 |
| `failure_count` | 0 (0%) | 851 | 20 / exact | 698 | 0 / 698 | 0/851/0/0/0 |
| `total_duration_ms` | 0 (0%) | 851 | 751 / exact | 8 | 0 / 0 | 0/851/0/0/0 |
| `calls_with_duration` | 0 (0%) | 851 | 135 / exact | 248 | 0 / 0 | 0/851/0/0/0 |

| Column | Numeric min / max / mean | Negative / positive counts | Text/BLOB length min / max / mean | Text/BLOB bytes |
| --- | --- | --- | --- | --- |
| `session_id` | withheld (identity/epoch) | 0 / 0 | 36 / 36 / 36 | 30,636 |
| `tool_name` | N/A / N/A / N/A | 0 / 0 | 4 / 42 / 9.529 | 8,109 |
| `native_tool_name` | N/A / N/A / N/A | 0 / 0 | 4 / 42 / 8.603 | 7,321 |
| `call_count` | 1 / 2,512 / 37.926 | 0 / 851 | N/A / N/A / N/A | 0 |
| `success_count` | 0 / 2,482 / 37.129 | 0 / 843 | N/A / N/A / N/A | 0 |
| `failure_count` | 0 / 49 / 0.797 | 0 / 153 | N/A / N/A / N/A | 0 |
| `total_duration_ms` | 3 / 75,057,290 / 776,067.606 | 0 / 851 | N/A / N/A / N/A | 0 |
| `calls_with_duration` | 1 / 2,512 / 37.926 | 0 / 851 | N/A / N/A / N/A | 0 |

Implicit rowid: 851 non-NULL integers, 0 NULL, 851 distinct, 0 zero, 0 negative (exact). Alias: none. Range withheld; text/BLOB lengths and empty strings are inapplicable.

### Provider populations

Counts include SQL NULLs, not JSON null strings. Non-NULL for any cell is provider rows minus its NULL count. Columns with no NULLs in any provider are omitted here only; their complete overall statistics remain above.

| Provider | Rows |
| --- | --- |
| claudeCode | 851 |

| Nullable column | claudeCode NULL |
| --- | --- |

## `session_segments`

Exact rows: **715**.

| Column | NULL (% rows) | Non-NULL | D / method | Peak frequency | Empty text / numeric zero | Types N/I/R/T/B |
| --- | --- | --- | --- | --- | --- | --- |
| `session_id` | 0 (0%) | 715 | 497 / exact | 17 | 0 / 0 | 0/0/0/715/0 |
| `start_timestamp` | 0 (0%) | 715 | 715 / exact | 1 | 0 / 0 | 0/0/0/715/0 |
| `end_timestamp` | 0 (0%) | 715 | 715 / exact | 1 | 0 / 0 | 0/0/0/715/0 |
| `total_tokens` | 0 (0%) | 715 | 608 / exact | 108 | 0 / 108 | 0/715/0/0/0 |
| `total_requests` | 0 (0%) | 715 | 325 / exact | 108 | 0 / 108 | 0/715/0/0/0 |
| `total_premium_requests` | 0 (0%) | 715 | 42 / exact | 321 | 0 / 321 | 0/0/715/0/0 |
| `total_api_duration_ms` | 0 (0%) | 715 | 607 / exact | 109 | 0 / 109 | 0/715/0/0/0 |
| `current_model` | 54 (7.552%) | 661 | 15 / exact | 221 | 0 / 0 | 54/0/0/661/0 |
| `model_metrics_json` | 0 (0%) | 715 | 609 / exact | 107 | 0 / 0 | 0/0/0/715/0 |
| `total_nano_aiu` | 661 (92.448%) | 54 | 40 / exact | 15 | 0 / 15 | 661/54/0/0/0 |
| `cost_usd` | 601 (84.056%) | 114 | 109 / exact | 6 | 0 / 6 | 601/0/114/0/0 |

| Column | Numeric min / max / mean | Negative / positive counts | Text/BLOB length min / max / mean | Text/BLOB bytes |
| --- | --- | --- | --- | --- |
| `session_id` | withheld (identity/epoch) | 0 / 0 | 36 / 36 / 36 | 25,740 |
| `start_timestamp` | N/A / N/A / N/A | 0 / 0 | 25 / 29 / 28.994 | 20,731 |
| `end_timestamp` | N/A / N/A / N/A | 0 / 0 | 29 / 29 / 29 | 20,735 |
| `total_tokens` | 0 / 541,915,598 / 21,151,694.941 | 0 / 607 | N/A / N/A / N/A | 0 |
| `total_requests` | 0 / 3,163 / 228.996 | 0 / 607 | N/A / N/A / N/A | 0 |
| `total_premium_requests` | 0 / 75 / 4.842 | 0 / 394 | N/A / N/A / N/A | 0 |
| `total_api_duration_ms` | 0 / 44,259,264 / 2,675,384.582 | 0 / 606 | N/A / N/A / N/A | 0 |
| `current_model` | N/A / N/A / N/A | 0 / 0 | 4 / 18 / 13.21 | 8,732 |
| `model_metrics_json` | N/A / N/A / N/A | 0 / 0 | 2 / 1,738 / 418.909 | 299,520 |
| `total_nano_aiu` | 0 / 104,070,240,000 / 5,649,607,500 | 0 / 39 | N/A / N/A / N/A | 0 |
| `cost_usd` | 0 / 199.776 / 22.329 | 0 / 108 | N/A / N/A / N/A | 0 |

Implicit rowid: 715 non-NULL integers, 0 NULL, 715 distinct, 0 zero, 0 negative (exact). Alias: none. Range withheld; text/BLOB lengths and empty strings are inapplicable.

### Provider populations

Counts include SQL NULLs, not JSON null strings. Non-NULL for any cell is provider rows minus its NULL count. Columns with no NULLs in any provider are omitted here only; their complete overall statistics remain above.

| Provider | Rows |
| --- | --- |
| claudeCode | 114 |
| copilot | 601 |

| Nullable column | claudeCode NULL | copilot NULL |
| --- | --- | --- |
| `current_model` | 6 | 48 |
| `total_nano_aiu` | 114 | 547 |
| `cost_usd` | 0 | 601 |

## `session_skill_invocations`

Exact rows: **181**.

| Column | NULL (% rows) | Non-NULL | D / method | Peak frequency | Empty text / numeric zero | Types N/I/R/T/B |
| --- | --- | --- | --- | --- | --- | --- |
| `session_id` | 0 (0%) | 181 | 78 / exact | 21 | 0 / 0 | 0/0/0/181/0 |
| `event_index` | 0 (0%) | 181 | 174 / exact | 4 | 0 / 0 | 0/181/0/0/0 |
| `turn_index` | 0 (0%) | 181 | 110 / exact | 14 | 0 / 14 | 0/181/0/0/0 |
| `tool_call_id` | 1 (0.552%) | 180 | 180 / exact | 1 | 0 / 0 | 1/0/0/180/0 |
| `timestamp` | 0 (0%) | 181 | 181 / exact | 1 | 0 / 0 | 0/0/0/181/0 |
| `skill_name` | 0 (0%) | 181 | 20 / exact | 54 | 0 / 0 | 0/0/0/181/0 |
| `normalized_name` | 0 (0%) | 181 | 20 / exact | 54 | 0 / 0 | 0/0/0/181/0 |
| `skill_path` | 16 (8.84%) | 165 | 17 / exact | 54 | 0 / 0 | 16/0/0/165/0 |
| `normalized_directory` | 16 (8.84%) | 165 | 17 / exact | 54 | 0 / 0 | 16/0/0/165/0 |
| `description` | 50 (27.624%) | 131 | 10 / exact | 54 | 0 / 0 | 50/0/0/131/0 |
| `source` | 175 (96.685%) | 6 | 2 / exact | 4 | 0 / 0 | 175/0/0/6/0 |
| `trigger` | 175 (96.685%) | 6 | 1 / exact | 6 | 0 / 0 | 175/0/0/6/0 |
| `agent_id` | 165 (91.16%) | 16 | 15 / exact | 2 | 0 / 0 | 165/0/0/16/0 |
| `agent_name` | 169 (93.37%) | 12 | 1 / exact | 12 | 0 / 0 | 169/0/0/12/0 |
| `model` | 0 (0%) | 181 | 10 / exact | 79 | 0 / 0 | 0/0/0/181/0 |
| `plugin_name` | 181 (100%) | 0 | 0 / exact | 0 | 0 / 0 | 181/0/0/0/0 |
| `plugin_version` | 181 (100%) | 0 | 0 / exact | 0 | 0 / 0 | 181/0/0/0/0 |
| `content_sha256` | 16 (8.84%) | 165 | 18 / exact | 54 | 0 / 0 | 16/0/0/165/0 |
| `frontmatter_tokens` | 16 (8.84%) | 165 | 8 / exact | 54 | 0 / 21 | 16/165/0/0/0 |
| `instruction_tokens` | 16 (8.84%) | 165 | 15 / exact | 54 | 0 / 4 | 16/165/0/0/0 |
| `origin` | 0 (0%) | 181 | 2 / exact | 175 | 0 / 0 | 0/0/0/181/0 |

| Column | Numeric min / max / mean | Negative / positive counts | Text/BLOB length min / max / mean | Text/BLOB bytes |
| --- | --- | --- | --- | --- |
| `session_id` | withheld (identity/epoch) | 0 / 0 | 36 / 36 / 36 | 6,516 |
| `event_index` | 6 / 29,893 / 3,129.983 | 0 / 181 | N/A / N/A / N/A | 0 |
| `turn_index` | 0 / 2,689 / 202.033 | 0 / 167 | N/A / N/A / N/A | 0 |
| `tool_call_id` | withheld (identity/epoch) | 0 / 0 | 29 / 32 / 29.622 | 5,332 |
| `timestamp` | N/A / N/A / N/A | 0 / 0 | 29 / 29 / 29 | 5,249 |
| `skill_name` | N/A / N/A / N/A | 0 / 0 | 3 / 33 / 16.939 | 3,066 |
| `normalized_name` | N/A / N/A / N/A | 0 / 0 | 3 / 33 / 16.939 | 3,066 |
| `skill_path` | N/A / N/A / N/A | 0 / 0 | 43 / 154 / 60.412 | 9,968 |
| `normalized_directory` | N/A / N/A / N/A | 0 / 0 | 34 / 145 / 51.412 | 8,483 |
| `description` | N/A / N/A / N/A | 0 / 0 | 78 / 807 / 332.466 | 43,563 |
| `source` | N/A / N/A / N/A | 0 / 0 | 7 / 16 / 13 | 78 |
| `trigger` | N/A / N/A / N/A | 0 / 0 | 13 / 13 / 13 | 78 |
| `agent_id` | withheld (identity/epoch) | 0 / 0 | 17 / 30 / 27.875 | 446 |
| `agent_name` | N/A / N/A / N/A | 0 / 0 | 15 / 15 / 15 | 180 |
| `model` | N/A / N/A / N/A | 0 / 0 | 7 / 20 / 12.26 | 2,219 |
| `plugin_name` | N/A / N/A / N/A | 0 / 0 | N/A / N/A / N/A | 0 |
| `plugin_version` | N/A / N/A / N/A | 0 / 0 | N/A / N/A / N/A | 0 |
| `content_sha256` | N/A / N/A / N/A | 0 / 0 | 64 / 64 / 64 | 10,560 |
| `frontmatter_tokens` | 0 / 211 / 76.752 | 0 / 144 | N/A / N/A / N/A | 0 |
| `instruction_tokens` | 0 / 4,803 / 2,184.855 | 0 / 161 | N/A / N/A / N/A | 0 |
| `origin` | N/A / N/A / N/A | 0 / 0 | 5 / 18 / 5.431 | 983 |

Implicit rowid: 181 non-NULL integers, 0 NULL, 181 distinct, 0 zero, 0 negative (exact). Alias: none. Range withheld; text/BLOB lengths and empty strings are inapplicable.

### Provider populations

Counts include SQL NULLs, not JSON null strings. Non-NULL for any cell is provider rows minus its NULL count. Columns with no NULLs in any provider are omitted here only; their complete overall statistics remain above.

| Provider | Rows |
| --- | --- |
| claudeCode | 10 |
| copilot | 171 |

| Nullable column | claudeCode NULL | copilot NULL |
| --- | --- | --- |
| `tool_call_id` | 0 | 1 |
| `skill_path` | 10 | 6 |
| `normalized_directory` | 10 | 6 |
| `description` | 10 | 40 |
| `source` | 10 | 165 |
| `trigger` | 10 | 165 |
| `agent_id` | 8 | 157 |
| `agent_name` | 8 | 161 |
| `plugin_name` | 10 | 171 |
| `plugin_version` | 10 | 171 |
| `content_sha256` | 10 | 6 |
| `frontmatter_tokens` | 10 | 6 |
| `instruction_tokens` | 10 | 6 |

## `session_tool_calls`

Exact rows: **5,120**.

| Column | NULL (% rows) | Non-NULL | D / method | Peak frequency | Empty text / numeric zero | Types N/I/R/T/B |
| --- | --- | --- | --- | --- | --- | --- |
| `session_id` | 0 (0%) | 5,120 | 442 / exact | 32 | 0 / 0 | 0/0/0/5,120/0 |
| `tool_name` | 0 (0%) | 5,120 | 94 / exact | 395 | 0 / 0 | 0/0/0/5,120/0 |
| `call_count` | 0 (0%) | 5,120 | 448 / exact | 930 | 0 / 0 | 0/5,120/0/0/0 |
| `success_count` | 0 (0%) | 5,120 | 447 / exact | 902 | 0 / 87 | 0/5,120/0/0/0 |
| `failure_count` | 0 (0%) | 5,120 | 46 / exact | 4,077 | 0 / 4,077 | 0/5,120/0/0/0 |
| `total_duration_ms` | 0 (0%) | 5,120 | 3,999 / exact | 54 | 0 / 30 | 0/5,120/0/0/0 |
| `calls_with_duration` | 0 (0%) | 5,120 | 452 / exact | 928 | 0 / 9 | 0/5,120/0/0/0 |

| Column | Numeric min / max / mean | Negative / positive counts | Text/BLOB length min / max / mean | Text/BLOB bytes |
| --- | --- | --- | --- | --- |
| `session_id` | withheld (identity/epoch) | 0 / 0 | 36 / 36 / 36 | 184,320 |
| `tool_name` | N/A / N/A / N/A | 0 / 0 | 2 / 42 / 9.616 | 49,234 |
| `call_count` | 1 / 4,701 / 58.689 | 0 / 5,120 | N/A / N/A / N/A | 0 |
| `success_count` | 0 / 4,671 / 57.76 | 0 / 5,033 | N/A / N/A / N/A | 0 |
| `failure_count` | 0 / 214 / 0.884 | 0 / 1,043 | N/A / N/A / N/A | 0 |
| `total_duration_ms` | 0 / 75,057,290 / 643,927.381 | 0 / 5,090 | N/A / N/A / N/A | 0 |
| `calls_with_duration` | 0 / 4,701 / 58.644 | 0 / 5,111 | N/A / N/A / N/A | 0 |

Implicit rowid: 5,120 non-NULL integers, 0 NULL, 5,120 distinct, 0 zero, 0 negative (exact). Alias: none. Range withheld; text/BLOB lengths and empty strings are inapplicable.

### Provider populations

Counts include SQL NULLs, not JSON null strings. Non-NULL for any cell is provider rows minus its NULL count. Columns with no NULLs in any provider are omitted here only; their complete overall statistics remain above.

| Provider | Rows |
| --- | --- |
| claudeCode | 851 |
| copilot | 4,269 |

| Nullable column | claudeCode NULL | copilot NULL |
| --- | --- | --- |

## `sessions`

Exact rows: **729**.

| Column | NULL (% rows) | Non-NULL | D / method | Peak frequency | Empty text / numeric zero | Types N/I/R/T/B |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | 0 (0%) | 729 | 729 / exact | 1 | 0 / 0 | 0/0/0/729/0 |
| `path` | 0 (0%) | 729 | 729 / exact | 1 | 0 / 0 | 0/0/0/729/0 |
| `summary` | 219 (30.041%) | 510 | 445 / exact | 13 | 0 / 0 | 219/0/0/510/0 |
| `repository` | 110 (15.089%) | 619 | 11 / exact | 450 | 0 / 0 | 110/0/0/619/0 |
| `branch` | 98 (13.443%) | 631 | 252 / exact | 206 | 0 / 0 | 98/0/0/631/0 |
| `cwd` | 0 (0%) | 729 | 81 / exact | 273 | 0 / 0 | 0/0/0/729/0 |
| `created_at` | 0 (0%) | 729 | 725 / exact | 5 | 0 / 0 | 0/0/0/729/0 |
| `updated_at` | 0 (0%) | 729 | 725 / exact | 5 | 0 / 0 | 0/0/0/729/0 |
| `event_count` | 211 (28.944%) | 518 | 420 / exact | 14 | 0 / 0 | 211/518/0/0/0 |
| `indexed_at` | 0 (0%) | 729 | 17 / exact | 115 | 0 / 0 | 0/0/0/729/0 |
| `host_type` | 260 (35.665%) | 469 | 1 / exact | 469 | 0 / 0 | 260/0/0/469/0 |
| `turn_count` | 211 (28.944%) | 518 | 250 / exact | 52 | 0 / 4 | 211/518/0/0/0 |
| `current_model` | 232 (31.824%) | 497 | 15 / exact | 158 | 0 / 0 | 232/0/0/497/0 |
| `total_premium_requests` | 342 (46.914%) | 387 | 45 / exact | 86 | 0 / 86 | 342/0/387/0/0 |
| `total_api_duration_ms` | 232 (31.824%) | 497 | 462 / exact | 36 | 0 / 36 | 232/497/0/0/0 |
| `workspace_mtime` | 110 (15.089%) | 619 | 619 / exact | 1 | 0 / 0 | 110/0/0/619/0 |
| `total_tokens` | 0 (0%) | 729 | 462 / exact | 268 | 0 / 268 | 0/729/0/0/0 |
| `total_cost` | 110 (15.089%) | 619 | 45 / exact | 318 | 0 / 318 | 110/0/619/0/0 |
| `tool_call_count` | 211 (28.944%) | 518 | 339 / exact | 76 | 0 / 76 | 211/518/0/0/0 |
| `lines_added` | 232 (31.824%) | 497 | 333 / exact | 143 | 0 / 143 | 232/497/0/0/0 |
| `lines_removed` | 232 (31.824%) | 497 | 221 / exact | 181 | 0 / 181 | 232/497/0/0/0 |
| `events_mtime` | 211 (28.944%) | 518 | 518 / exact | 1 | 0 / 0 | 211/0/0/518/0 |
| `events_size` | 211 (28.944%) | 518 | 508 / exact | 5 | 0 / 0 | 211/518/0/0/0 |
| `analytics_version` | 0 (0%) | 729 | 2 / exact | 619 | 0 / 0 | 0/729/0/0/0 |
| `error_count` | 0 (0%) | 729 | 9 / exact | 662 | 0 / 662 | 0/729/0/0/0 |
| `rate_limit_count` | 0 (0%) | 729 | 8 / exact | 678 | 0 / 678 | 0/729/0/0/0 |
| `compaction_count` | 0 (0%) | 729 | 18 / exact | 515 | 0 / 515 | 0/729/0/0/0 |
| `truncation_count` | 0 (0%) | 729 | 2 / exact | 727 | 0 / 727 | 0/729/0/0/0 |
| `total_compaction_input_tokens` | 0 (0%) | 729 | 181 / exact | 549 | 0 / 549 | 0/729/0/0/0 |
| `total_compaction_output_tokens` | 0 (0%) | 729 | 180 / exact | 549 | 0 / 549 | 0/729/0/0/0 |
| `search_indexed_at` | 0 (0%) | 729 | 729 / exact | 1 | 0 / 0 | 0/0/0/729/0 |
| `search_extractor_version` | 0 (0%) | 729 | 2 / exact | 619 | 0 / 0 | 0/729/0/0/0 |
| `copilot_version` | 321 (44.033%) | 408 | 50 / exact | 39 | 0 / 0 | 321/0/0/408/0 |
| `total_nano_aiu` | 689 (94.513%) | 40 | 30 / exact | 11 | 0 / 11 | 689/40/0/0/0 |
| `source_fingerprint` | 0 (0%) | 729 | 729 / exact | 1 | 0 / 0 | 0/0/0/729/0 |
| `search_source_fingerprint` | 0 (0%) | 729 | 519 / exact | 211 | 0 / 0 | 0/0/0/729/0 |
| `source` | 0 (0%) | 729 | 2 / exact | 619 | 0 / 0 | 0/0/0/729/0 |
| `parent_session_id` | 729 (100%) | 0 | 0 / exact | 0 | 0 / 0 | 729/0/0/0/0 |
| `role` | 0 (0%) | 729 | 1 / exact | 729 | 0 / 0 | 0/0/0/729/0 |
| `hidden` | 0 (0%) | 729 | 1 / exact | 729 | 0 / 729 | 0/729/0/0/0 |
| `source_format_version` | 729 (100%) | 0 | 0 / exact | 0 | 0 / 0 | 729/0/0/0/0 |
| `cost_usd` | 619 (84.911%) | 110 | 105 / exact | 6 | 0 / 6 | 619/0/110/0/0 |

| Column | Numeric min / max / mean | Negative / positive counts | Text/BLOB length min / max / mean | Text/BLOB bytes |
| --- | --- | --- | --- | --- |
| `id` | withheld (identity/epoch) | 0 / 0 | 36 / 36 / 36 | 26,244 |
| `path` | N/A / N/A / N/A | 0 / 0 | 74 / 151 / 77.571 | 56,549 |
| `summary` | N/A / N/A / N/A | 0 / 0 | 3 / 1,880 / 43.349 | 22,112 |
| `repository` | N/A / N/A / N/A | 0 / 0 | 11 / 48 / 23.952 | 14,826 |
| `branch` | N/A / N/A / N/A | 0 / 0 | 4 / 47 / 17.363 | 10,956 |
| `cwd` | N/A / N/A / N/A | 0 / 0 | 6 / 145 / 27.487 | 20,038 |
| `created_at` | N/A / N/A / N/A | 0 / 0 | 29 / 29 / 29 | 21,141 |
| `updated_at` | N/A / N/A / N/A | 0 / 0 | 29 / 29 / 29 | 21,141 |
| `event_count` | 3 / 35,032 / 2,177.693 | 0 / 518 | N/A / N/A / N/A | 0 |
| `indexed_at` | N/A / N/A / N/A | 0 / 0 | 19 / 19 / 19 | 13,851 |
| `host_type` | N/A / N/A / N/A | 0 / 0 | 6 / 6 / 6 | 2,814 |
| `turn_count` | 0 / 3,095 / 155.631 | 0 / 514 | N/A / N/A / N/A | 0 |
| `current_model` | N/A / N/A / N/A | 0 / 0 | 4 / 18 / 13.231 | 6,576 |
| `total_premium_requests` | 0 / 120 / 8.946 | 0 / 301 | N/A / N/A / N/A | 0 |
| `total_api_duration_ms` | 0 / 83,589,297 / 3,848,893.312 | 0 / 461 | N/A / N/A / N/A | 0 |
| `workspace_mtime` | N/A / N/A / N/A | 0 / 0 | 32 / 35 / 34.661 | 21,455 |
| `total_tokens` | 0 / 591,010,885 / 20,745,489.551 | 0 / 461 | N/A / N/A / N/A | 0 |
| `total_cost` | 0 / 120 / 5.59 | 0 / 301 | N/A / N/A / N/A | 0 |
| `tool_call_count` | 0 / 10,009 / 580.091 | 0 / 442 | N/A / N/A / N/A | 0 |
| `lines_added` | 0 / 93,503 / 2,106.573 | 0 / 354 | N/A / N/A / N/A | 0 |
| `lines_removed` | 0 / 7,284 / 232.994 | 0 / 316 | N/A / N/A / N/A | 0 |
| `events_mtime` | N/A / N/A / N/A | 0 / 0 | 32 / 35 / 34.699 | 17,974 |
| `events_size` | 1,006 / 116,939,527 / 6,919,563.819 | 0 / 518 | N/A / N/A / N/A | 0 |
| `analytics_version` | 18 / 30 / 19.811 | 0 / 729 | N/A / N/A / N/A | 0 |
| `error_count` | 0 / 8 / 0.195 | 0 / 67 | N/A / N/A / N/A | 0 |
| `rate_limit_count` | 0 / 7 / 0.141 | 0 / 51 | N/A / N/A / N/A | 0 |
| `compaction_count` | 0 / 42 / 1.047 | 0 / 214 | N/A / N/A / N/A | 0 |
| `truncation_count` | 0 / 1 / 0.003 | 0 / 2 | N/A / N/A / N/A | 0 |
| `total_compaction_input_tokens` | 0 / 5,126,649 / 113,725.318 | 0 / 180 | N/A / N/A / N/A | 0 |
| `total_compaction_output_tokens` | 0 / 239,615 / 4,322.89 | 0 / 180 | N/A / N/A / N/A | 0 |
| `search_indexed_at` | N/A / N/A / N/A | 0 / 0 | 32 / 35 / 34.745 | 25,329 |
| `search_extractor_version` | 4 / 9 / 4.754 | 0 / 729 | N/A / N/A / N/A | 0 |
| `copilot_version` | N/A / N/A / N/A | 0 / 0 | 5 / 7 / 5.775 | 2,356 |
| `total_nano_aiu` | 0 / 188,594,945,000 / 7,626,970,125 | 0 / 29 | N/A / N/A / N/A | 0 |
| `source_fingerprint` | N/A / N/A / N/A | 0 / 0 | 111 / 12,095 / 262.96 | 191,698 |
| `search_source_fingerprint` | N/A / N/A / N/A | 0 / 0 | 4 / 12,095 / 170.492 | 124,289 |
| `source` | N/A / N/A / N/A | 0 / 0 | 7 / 10 / 7.453 | 5,433 |
| `parent_session_id` | withheld (identity/epoch) | 0 / 0 | N/A / N/A / N/A | 0 |
| `role` | N/A / N/A / N/A | 0 / 0 | 7 / 7 / 7 | 5,103 |
| `hidden` | 0 / 0 / 0 | 0 / 0 | N/A / N/A / N/A | 0 |
| `source_format_version` | N/A / N/A / N/A | 0 / 0 | N/A / N/A / N/A | 0 |
| `cost_usd` | 0 / 245.214 / 23.141 | 0 / 104 | N/A / N/A / N/A | 0 |

Implicit rowid: 729 non-NULL integers, 0 NULL, 729 distinct, 0 zero, 0 negative (exact). Alias: none. Range withheld; text/BLOB lengths and empty strings are inapplicable.

### Provider populations

Counts include SQL NULLs, not JSON null strings. Non-NULL for any cell is provider rows minus its NULL count. Columns with no NULLs in any provider are omitted here only; their complete overall statistics remain above.

| Provider | Rows |
| --- | --- |
| claudeCode | 110 |
| copilot | 619 |

| Nullable column | claudeCode NULL | copilot NULL |
| --- | --- | --- |
| `summary` | 4 | 215 |
| `repository` | 8 | 102 |
| `branch` | 0 | 98 |
| `event_count` | 0 | 211 |
| `host_type` | 110 | 150 |
| `turn_count` | 0 | 211 |
| `current_model` | 6 | 226 |
| `total_premium_requests` | 110 | 232 |
| `total_api_duration_ms` | 0 | 232 |
| `workspace_mtime` | 110 | 0 |
| `total_cost` | 110 | 0 |
| `tool_call_count` | 0 | 211 |
| `lines_added` | 0 | 232 |
| `lines_removed` | 0 | 232 |
| `events_mtime` | 0 | 211 |
| `events_size` | 0 | 211 |
| `copilot_version` | 110 | 211 |
| `total_nano_aiu` | 110 | 579 |
| `parent_session_id` | 110 | 619 |
| `source_format_version` | 110 | 619 |
| `cost_usd` | 0 | 619 |

## `sessions_fts`

Exact rows: **729**.

| Column | NULL (% rows) | Non-NULL | D / method | Peak frequency | Empty text / numeric zero | Types N/I/R/T/B |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | 0 (0%) | 729 | 729 / exact | 1 | 0 / 0 | 0/0/0/729/0 |
| `summary` | 219 (30.041%) | 510 | 445 / exact | 13 | 0 / 0 | 219/0/0/510/0 |
| `repository` | 110 (15.089%) | 619 | 11 / exact | 450 | 0 / 0 | 110/0/0/619/0 |
| `branch` | 98 (13.443%) | 631 | 252 / exact | 206 | 0 / 0 | 98/0/0/631/0 |
| `sessions_fts` | 0 (0%) | 729 | 1 / exact | 729 | 0 / 0 | 0/729/0/0/0 |
| `rank` | 729 (100%) | 0 | 0 / exact | 0 | 0 / 0 | 729/0/0/0/0 |

| Column | Numeric min / max / mean | Negative / positive counts | Text/BLOB length min / max / mean | Text/BLOB bytes |
| --- | --- | --- | --- | --- |
| `id` | withheld (identity/epoch) | 0 / 0 | 36 / 36 / 36 | 26,244 |
| `summary` | N/A / N/A / N/A | 0 / 0 | 3 / 1,880 / 43.349 | 22,112 |
| `repository` | N/A / N/A / N/A | 0 / 0 | 11 / 48 / 23.952 | 14,826 |
| `branch` | N/A / N/A / N/A | 0 / 0 | 4 / 47 / 17.363 | 10,956 |
| `sessions_fts` | 7 / 7 / 7 | 0 / 729 | N/A / N/A / N/A | 0 |
| `rank` | N/A / N/A / N/A | 0 / 0 | N/A / N/A / N/A | 0 |

Implicit rowid: 729 non-NULL integers, 0 NULL, 729 distinct, 0 zero, 0 negative (exact). Alias: none. Range withheld; text/BLOB lengths and empty strings are inapplicable.

## `sessions_fts_config`

Exact rows: **1**.

| Column | NULL (% rows) | Non-NULL | D / method | Peak frequency | Empty text / numeric zero | Types N/I/R/T/B |
| --- | --- | --- | --- | --- | --- | --- |
| `k` | 0 (0%) | 1 | 1 / exact | 1 | 0 / 0 | 0/0/0/1/0 |
| `v` | 0 (0%) | 1 | 1 / exact | 1 | 0 / 0 | 0/1/0/0/0 |

| Column | Numeric min / max / mean | Negative / positive counts | Text/BLOB length min / max / mean | Text/BLOB bytes |
| --- | --- | --- | --- | --- |
| `k` | N/A / N/A / N/A | 0 / 0 | 7 / 7 / 7 | 7 |
| `v` | 4 / 4 / 4 | 0 / 1 | N/A / N/A / N/A | 0 |

## `sessions_fts_data`

Exact rows: **61**.

| Column | NULL (% rows) | Non-NULL | D / method | Peak frequency | Empty text / numeric zero | Types N/I/R/T/B |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | 0 (0%) | 61 | 61 / exact | 1 | 0 / 0 | 0/61/0/0/0 |
| `block` | 0 (0%) | 61 | 61 / exact | 1 | 0 / 0 | 0/0/0/0/61 |

| Column | Numeric min / max / mean | Negative / positive counts | Text/BLOB length min / max / mean | Text/BLOB bytes |
| --- | --- | --- | --- | --- |
| `id` | withheld (identity/epoch) | 0 / 61 | N/A / N/A / N/A | 0 |
| `block` | N/A / N/A / N/A | 0 / 0 | 10 / 4,052 / 3,682.148 | 224,611 |

Implicit rowid: 61 non-NULL integers, 0 NULL, 61 distinct, 0 zero, 0 negative (exact). Alias: id. Range withheld; text/BLOB lengths and empty strings are inapplicable.

## `sessions_fts_docsize`

Exact rows: **729**.

| Column | NULL (% rows) | Non-NULL | D / method | Peak frequency | Empty text / numeric zero | Types N/I/R/T/B |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | 0 (0%) | 729 | 729 / exact | 1 | 0 / 0 | 0/729/0/0/0 |
| `sz` | 0 (0%) | 729 | 72 / exact | 80 | 0 / 0 | 0/0/0/0/729 |

| Column | Numeric min / max / mean | Negative / positive counts | Text/BLOB length min / max / mean | Text/BLOB bytes |
| --- | --- | --- | --- | --- |
| `id` | withheld (identity/epoch) | 0 / 729 | N/A / N/A / N/A | 0 |
| `sz` | N/A / N/A / N/A | 0 / 0 | 4 / 5 / 4.001 | 2,917 |

Implicit rowid: 729 non-NULL integers, 0 NULL, 729 distinct, 0 zero, 0 negative (exact). Alias: id. Range withheld; text/BLOB lengths and empty strings are inapplicable.

## `sessions_fts_idx`

Exact rows: **59**.

| Column | NULL (% rows) | Non-NULL | D / method | Peak frequency | Empty text / numeric zero | Types N/I/R/T/B |
| --- | --- | --- | --- | --- | --- | --- |
| `segid` | 0 (0%) | 59 | 7 / exact | 16 | 0 / 0 | 0/59/0/0/0 |
| `term` | 0 (0%) | 59 | 49 / exact | 7 | 0 / 0 | 0/0/0/0/59 |
| `pgno` | 0 (0%) | 59 | 16 / exact | 7 | 0 / 0 | 0/59/0/0/0 |

| Column | Numeric min / max / mean | Negative / positive counts | Text/BLOB length min / max / mean | Text/BLOB bytes |
| --- | --- | --- | --- | --- |
| `segid` | withheld (identity/epoch) | 0 / 59 | N/A / N/A / N/A | 0 |
| `term` | N/A / N/A / N/A | 0 / 0 | 0 / 11 / 4.119 | 243 |
| `pgno` | withheld (identity/epoch) | 0 / 59 | N/A / N/A / N/A | 0 |

## `sqlite_schema`

Exact rows: **66**.

| Column | NULL (% rows) | Non-NULL | D / method | Peak frequency | Empty text / numeric zero | Types N/I/R/T/B |
| --- | --- | --- | --- | --- | --- | --- |
| `type` | 0 (0%) | 66 | 3 / exact | 30 | 0 / 0 | 0/0/0/66/0 |
| `name` | 0 (0%) | 66 | 66 / exact | 1 | 0 / 0 | 0/0/0/66/0 |
| `tbl_name` | 0 (0%) | 66 | 30 / exact | 9 | 0 / 0 | 0/0/0/66/0 |
| `rootpage` | 0 (0%) | 66 | 59 / exact | 8 | 0 / 8 | 0/66/0/0/0 |
| `sql` | 14 (21.212%) | 52 | 52 / exact | 1 | 0 / 0 | 14/0/0/52/0 |

| Column | Numeric min / max / mean | Negative / positive counts | Text/BLOB length min / max / mean | Text/BLOB bytes |
| --- | --- | --- | --- | --- |
| `type` | N/A / N/A / N/A | 0 / 0 | 5 / 7 / 5.182 | 342 |
| `name` | N/A / N/A / N/A | 0 / 0 | 8 / 46 / 23.788 | 1,570 |
| `tbl_name` | N/A / N/A / N/A | 0 / 0 | 8 / 27 / 16.636 | 1,098 |
| `rootpage` | 0 / 60 / 27.682 | 0 / 58 | N/A / N/A / N/A | 0 |
| `sql` | N/A / N/A / N/A | 0 / 0 | 38 / 1,757 / 262.712 | 13,661 |

Implicit rowid: 66 non-NULL integers, 0 NULL, 66 distinct, 0 zero, 0 negative (exact). Alias: none. Range withheld; text/BLOB lengths and empty strings are inapplicable.

## `sqlite_sequence`

Exact rows: **1**.

| Column | NULL (% rows) | Non-NULL | D / method | Peak frequency | Empty text / numeric zero | Types N/I/R/T/B |
| --- | --- | --- | --- | --- | --- | --- |
| `name` | 0 (0%) | 1 | 1 / exact | 1 | 0 / 0 | 0/0/0/1/0 |
| `seq` | 0 (0%) | 1 | 1 / exact | 1 | 0 / 0 | 0/1/0/0/0 |

| Column | Numeric min / max / mean | Negative / positive counts | Text/BLOB length min / max / mean | Text/BLOB bytes |
| --- | --- | --- | --- | --- |
| `name` | N/A / N/A / N/A | 0 / 0 | 14 / 14 / 14 | 14 |
| `seq` | withheld (identity/epoch) | 0 / 1 | N/A / N/A / N/A | 0 |

Implicit rowid: 1 non-NULL integers, 0 NULL, 1 distinct, 0 zero, 0 negative (exact). Alias: none. Range withheld; text/BLOB lengths and empty strings are inapplicable.

## `sqlite_stat1`

Exact rows: **35**.

| Column | NULL (% rows) | Non-NULL | D / method | Peak frequency | Empty text / numeric zero | Types N/I/R/T/B |
| --- | --- | --- | --- | --- | --- | --- |
| `tbl` | 0 (0%) | 35 | 22 / exact | 5 | 0 / 0 | 0/0/0/35/0 |
| `idx` | 5 (14.286%) | 30 | 30 / exact | 1 | 0 / 0 | 5/0/0/30/0 |
| `stat` | 0 (0%) | 35 | 33 / exact | 2 | 0 / 0 | 0/0/0/35/0 |

| Column | Numeric min / max / mean | Negative / positive counts | Text/BLOB length min / max / mean | Text/BLOB bytes |
| --- | --- | --- | --- | --- |
| `tbl` | N/A / N/A / N/A | 0 / 0 | 8 / 25 / 16.571 | 580 |
| `idx` | N/A / N/A / N/A | 0 / 0 | 14 / 44 / 29.4 | 882 |
| `stat` | N/A / N/A / N/A | 0 / 0 | 2 / 15 / 7.114 | 249 |

Implicit rowid: 35 non-NULL integers, 0 NULL, 35 distinct, 0 zero, 0 negative (exact). Alias: none. Range withheld; text/BLOB lengths and empty strings are inapplicable.

## `sqlite_stat4`

Exact rows: **612**.

| Column | NULL (% rows) | Non-NULL | D / method | Peak frequency | Empty text / numeric zero | Types N/I/R/T/B |
| --- | --- | --- | --- | --- | --- | --- |
| `tbl` | 0 (0%) | 612 | 17 / exact | 120 | 0 / 0 | 0/0/0/612/0 |
| `idx` | 0 (0%) | 612 | 30 / exact | 24 | 0 / 0 | 0/0/0/612/0 |
| `neq` | 0 (0%) | 612 | 232 / exact | 130 | 0 / 0 | 0/0/0/612/0 |
| `nlt` | 0 (0%) | 612 | 575 / exact | 3 | 0 / 0 | 0/0/0/612/0 |
| `ndlt` | 0 (0%) | 612 | 599 / exact | 3 | 0 / 0 | 0/0/0/612/0 |
| `sample` | 0 (0%) | 612 | 609 / exact | 2 | 0 / 0 | 0/0/0/0/612 |

| Column | Numeric min / max / mean | Negative / positive counts | Text/BLOB length min / max / mean | Text/BLOB bytes |
| --- | --- | --- | --- | --- |
| `tbl` | N/A / N/A / N/A | 0 / 0 | 8 / 25 / 16.471 | 10,080 |
| `idx` | N/A / N/A / N/A | 0 / 0 | 14 / 44 / 30.688 | 18,781 |
| `neq` | N/A / N/A / N/A | 0 / 0 | 1 / 13 / 5.672 | 3,471 |
| `nlt` | N/A / N/A / N/A | 0 / 0 | 1 / 27 / 11.049 | 6,762 |
| `ndlt` | N/A / N/A / N/A | 0 / 0 | 1 / 24 / 9.987 | 6,112 |
| `sample` | N/A / N/A / N/A | 0 / 0 | 4 / 146 / 45.242 | 27,688 |

Implicit rowid: 612 non-NULL integers, 0 NULL, 612 distinct, 0 zero, 0 negative (exact). Alias: none. Range withheld; text/BLOB lengths and empty strings are inapplicable.
