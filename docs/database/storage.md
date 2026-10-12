# Physical storage accounting

Frozen database: **578,736,128 bytes**, 141,293 pages of 4096 bytes. Freelist: 239 pages / 978,944 bytes. Other structural pages: 708,608 bytes (principally incremental-auto-vacuum pointer maps).

`dbstat` runtime SQLite 3.50.4. Each physical B-tree appears once below. FTS virtual rows expose external content already in sessions/search_content: adding their logical text bytes again would double-count it. Only their shadow B-trees consume separately attributed pages. Index payload duplicates indexed values by design. Payload and unused bytes are subdivisions of allocated bytes, not extra allocations; overflow is likewise included. Neither freed pages nor WAL/SHM are included in dbstat B-tree totals. Unused bytes measure page slack; they are not all reclaimable by dropping a column. [Snapshot provenance and live sidecar sizes](methodology.md).

| B-tree | Pages | Allocated bytes | Payload bytes | Unused bytes | Overflow pages / bytes | Largest cell payload |
| --- | --- | --- | --- | --- | --- | --- |
| `idx_agent_runs_name_started` | 81 | 331,776 | 266,398 | 46,935 | 0 / 0 | 50 |
| `idx_agent_runs_started` | 61 | 249,856 | 198,050 | 33,603 | 0 / 0 | 34 |
| `idx_search_content_session_event` | 9,042 | 37,036,032 | 30,506,716 | 4,382,781 | 0 / 0 | 46 |
| `idx_search_content_session_ts_type` | 11,577 | 47,419,392 | 39,757,386 | 5,485,051 | 0 / 0 | 66 |
| `idx_search_content_timestamp` | 2,448 | 10,027,008 | 6,760,555 | 1,199,046 | 0 / 0 | 10 |
| `idx_search_content_tool` | 2,597 | 10,637,312 | 7,419,429 | 1,148,688 | 0 / 0 | 48 |
| `idx_search_content_type_ts` | 4,644 | 19,021,824 | 14,621,621 | 2,306,444 | 0 / 0 | 29 |
| `idx_session_incidents_session` | 22 | 90,112 | 71,209 | 15,634 | 0 / 0 | 71 |
| `idx_session_incidents_type` | 6 | 24,576 | 14,047 | 7,452 | 0 / 0 | 15 |
| `idx_session_segments_end_ts` | 8 | 32,768 | 24,310 | 6,221 | 0 / 0 | 34 |
| `idx_sessions_nonempty_updated_at` | 7 | 28,672 | 17,381 | 9,669 | 0 / 0 | 34 |
| `idx_sessions_repo_updated` | 12 | 49,152 | 40,213 | 6,612 | 0 / 0 | 83 |
| `idx_sessions_source` | 4 | 16,384 | 8,950 | 5,203 | 0 / 0 | 15 |
| `idx_sessions_updated_at` | 8 | 32,768 | 24,658 | 5,831 | 0 / 0 | 34 |
| `idx_skill_invocations_name_ts` | 4 | 16,384 | 9,401 | 6,396 | 0 / 0 | 68 |
| `idx_skill_invocations_ts` | 3 | 12,288 | 6,154 | 5,559 | 0 / 0 | 34 |
| `maintenance_state` | 1 | 4,096 | 27 | 4,057 | 0 / 0 | 27 |
| `schema_version` | 1 | 4,096 | 551 | 3,441 | 0 / 0 | 23 |
| `search_content` | 82,227 | 336,801,792 | 294,972,285 | 35,820,580 | 4,162 / 17,047,552 | 24,905 |
| `search_fts_config` | 1 | 4,096 | 24 | 4,058 | 0 / 0 | 13 |
| `search_fts_data` | 21,327 | 87,355,392 | 86,060,476 | 650,211 | 0 / 0 | 4,057 |
| `search_fts_docsize` | 1,676 | 6,864,896 | 2,761,685 | 15,229 | 0 / 0 | 5 |
| `search_fts_idx` | 42 | 172,032 | 112,390 | 35,840 | 0 / 0 | 311 |
| `session_activity` | 18 | 73,728 | 55,456 | 11,726 | 0 / 0 | 45 |
| `session_agent_runs` | 831 | 3,403,776 | 3,094,612 | 260,938 | 0 / 0 | 964 |
| `session_agent_selections` | 1 | 4,096 | 0 | 4,088 | 0 / 0 | 0 |
| `session_cache_ttls` | 1 | 4,096 | 1,686 | 2,282 | 0 / 0 | 62 |
| `session_cache_windows` | 21 | 86,016 | 76,793 | 5,912 | 0 / 0 | 173 |
| `session_format_observations` | 11 | 45,056 | 36,895 | 4,895 | 0 / 0 | 81 |
| `session_incidents` | 2,966 | 12,148,736 | 11,617,509 | 504,163 | 2,468 / 10,108,928 | 34,792 |
| `session_model_metrics` | 25 | 102,400 | 85,543 | 10,759 | 0 / 0 | 91 |
| `session_modified_files` | 177 | 724,992 | 675,514 | 16,522 | 0 / 0 | 224 |
| `session_native_tool_calls` | 17 | 69,632 | 57,668 | 7,575 | 0 / 0 | 131 |
| `session_segments` | 109 | 446,464 | 391,029 | 49,520 | 0 / 0 | 1,871 |
| `session_skill_invocations` | 30 | 122,880 | 105,182 | 16,144 | 0 / 0 | 1,142 |
| `session_tool_calls` | 83 | 339,968 | 300,415 | 12,637 | 0 / 0 | 89 |
| `sessions` | 192 | 786,432 | 655,844 | 123,556 | 25 / 102,400 | 24,653 |
| `sessions_fts_config` | 1 | 4,096 | 11 | 4,074 | 0 / 0 | 11 |
| `sessions_fts_data` | 60 | 245,760 | 224,853 | 19,135 | 0 / 0 | 4,056 |
| `sessions_fts_docsize` | 4 | 16,384 | 5,104 | 7,710 | 0 / 0 | 8 |
| `sessions_fts_idx` | 1 | 4,096 | 597 | 3,314 | 0 / 0 | 17 |
| `sqlite_autoindex_maintenance_state_1` | 1 | 4,096 | 17 | 4,068 | 0 / 0 | 17 |
| `sqlite_autoindex_session_activity_1` | 17 | 69,632 | 56,055 | 9,615 | 0 / 0 | 45 |
| `sqlite_autoindex_session_agent_runs_1` | 125 | 512,000 | 419,083 | 73,946 | 0 / 0 | 77 |
| `sqlite_autoindex_session_agent_selections_1` | 1 | 4,096 | 0 | 4,088 | 0 / 0 | 0 |
| `sqlite_autoindex_session_cache_ttls_1` | 1 | 4,096 | 1,703 | 2,295 | 0 / 0 | 62 |
| `sqlite_autoindex_session_cache_windows_1` | 8 | 32,768 | 22,533 | 8,550 | 0 / 0 | 43 |
| `sqlite_autoindex_session_format_observations_1` | 12 | 49,152 | 37,807 | 9,267 | 0 / 0 | 82 |
| `sqlite_autoindex_session_model_metrics_1` | 19 | 77,824 | 64,455 | 9,719 | 0 / 0 | 67 |
| `sqlite_autoindex_session_modified_files_1` | 195 | 798,720 | 673,702 | 104,003 | 0 / 0 | 224 |
| `sqlite_autoindex_session_native_tool_calls_1` | 16 | 65,536 | 51,895 | 10,900 | 0 / 0 | 127 |
| `sqlite_autoindex_session_segments_1` | 15 | 61,440 | 50,765 | 8,354 | 0 / 0 | 71 |
| `sqlite_autoindex_session_skill_invocations_1` | 4 | 16,384 | 7,937 | 7,860 | 0 / 0 | 44 |
| `sqlite_autoindex_session_tool_calls_1` | 80 | 327,680 | 264,274 | 47,090 | 0 / 0 | 84 |
| `sqlite_autoindex_sessions_1` | 10 | 40,960 | 29,761 | 8,896 | 0 / 0 | 41 |
| `sqlite_schema` | 6 | 24,576 | 17,173 | 6,922 | 0 / 0 | 1,806 |
| `sqlite_sequence` | 1 | 4,096 | 20 | 4,064 | 0 / 0 | 20 |
| `sqlite_stat1` | 1 | 4,096 | 1,851 | 2,097 | 0 / 0 | 80 |
| `sqlite_stat4` | 22 | 90,112 | 77,330 | 9,196 | 0 / 0 | 250 |

## Table ownership totals

Includes each table and its own constraint/secondary indexes. Virtual FTS totals include their four shadows and shadow indexes, not external content. Zero means no independent B-tree, not no useful data.

| Table owner | Exact rows | Own B-tree bytes | Owned index/shadow bytes | Total allocated |
| --- | --- | --- | --- | --- |
| `maintenance_state` | 1 | 4,096 | 4,096 | 8,192 |
| `schema_version` | 24 | 4,096 | 0 | 4,096 |
| `search_content` | 679,345 | 336,801,792 | 124,141,568 | 460,943,360 |
| `search_fts` | 679,345 | 0 | 94,396,416 | 94,396,416 |
| `search_fts_config` | 2 | 4,096 | 0 | 4,096 |
| `search_fts_data` | 21,946 | 87,355,392 | 0 | 87,355,392 |
| `search_fts_docsize` | 679,345 | 6,864,896 | 0 | 6,864,896 |
| `search_fts_idx` | 7,767 | 172,032 | 0 | 172,032 |
| `session_activity` | 1,254 | 73,728 | 69,632 | 143,360 |
| `session_agent_runs` | 5,825 | 3,403,776 | 1,093,632 | 4,497,408 |
| `session_agent_selections` | 0 | 4,096 | 4,096 | 8,192 |
| `session_cache_ttls` | 30 | 4,096 | 4,096 | 8,192 |
| `session_cache_windows` | 531 | 86,016 | 32,768 | 118,784 |
| `session_format_observations` | 646 | 45,056 | 49,152 | 94,208 |
| `session_incidents` | 1,003 | 12,148,736 | 114,688 | 12,263,424 |
| `session_model_metrics` | 1,142 | 102,400 | 77,824 | 180,224 |
| `session_modified_files` | 5,719 | 724,992 | 798,720 | 1,523,712 |
| `session_native_tool_calls` | 851 | 69,632 | 65,536 | 135,168 |
| `session_segments` | 715 | 446,464 | 94,208 | 540,672 |
| `session_skill_invocations` | 181 | 122,880 | 45,056 | 167,936 |
| `session_tool_calls` | 5,120 | 339,968 | 327,680 | 667,648 |
| `sessions` | 729 | 786,432 | 167,936 | 954,368 |
| `sessions_fts` | 729 | 0 | 270,336 | 270,336 |
| `sessions_fts_config` | 1 | 4,096 | 0 | 4,096 |
| `sessions_fts_data` | 61 | 245,760 | 0 | 245,760 |
| `sessions_fts_docsize` | 729 | 16,384 | 0 | 16,384 |
| `sessions_fts_idx` | 59 | 4,096 | 0 | 4,096 |
| `sqlite_schema` | 66 | 24,576 | 0 | 24,576 |
| `sqlite_sequence` | 1 | 4,096 | 0 | 4,096 |
| `sqlite_stat1` | 35 | 4,096 | 0 | 4,096 |
| `sqlite_stat4` | 612 | 90,112 | 0 | 90,112 |

Do not sum virtual ownership totals together with the shadow rows: that view deliberately shows both parent ownership and child attribution. The first B-tree table plus freelist plus structural pages is the non-overlapping reconciliation.
