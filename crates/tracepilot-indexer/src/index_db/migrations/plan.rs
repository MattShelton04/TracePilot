//! Index database migration plan and version order.

use super::columns::ensure_search_columns;
use super::sql::{
    MIGRATION_1, MIGRATION_2, MIGRATION_3, MIGRATION_4, MIGRATION_5, MIGRATION_6, MIGRATION_7,
    MIGRATION_8, MIGRATION_9, MIGRATION_10, MIGRATION_11, MIGRATION_13, MIGRATION_14, MIGRATION_15,
    MIGRATION_16, MIGRATION_17, MIGRATION_18, MIGRATION_19, MIGRATION_20,
};
use tracepilot_core::utils::migrator::{Migration, MigrationPlan};

pub(super) static INDEX_DB_MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        name: "base schema",
        sql: MIGRATION_1,
        pre_hook: None,
    },
    Migration {
        version: 2,
        name: "enriched schema",
        sql: MIGRATION_2,
        pre_hook: None,
    },
    Migration {
        version: 3,
        name: "analytics schema",
        sql: MIGRATION_3,
        pre_hook: None,
    },
    Migration {
        version: 4,
        name: "tool duration tracking",
        sql: MIGRATION_4,
        pre_hook: None,
    },
    Migration {
        version: 5,
        name: "incident tracking",
        sql: MIGRATION_5,
        pre_hook: None,
    },
    Migration {
        version: 6,
        name: "deep FTS search",
        sql: MIGRATION_6,
        pre_hook: None,
    },
    Migration {
        version: 7,
        name: "browse indexes",
        sql: MIGRATION_7,
        pre_hook: None,
    },
    Migration {
        version: 8,
        name: "daily metric tracking",
        sql: MIGRATION_8,
        pre_hook: None,
    },
    Migration {
        version: 9,
        name: "tool_result, content_fts, quality guard",
        sql: MIGRATION_9,
        pre_hook: Some(ensure_search_columns),
    },
    Migration {
        version: 10,
        name: "maintenance state",
        sql: MIGRATION_10,
        pre_hook: None,
    },
    Migration {
        version: 11,
        name: "reasoning tokens",
        sql: MIGRATION_11,
        pre_hook: None,
    },
    Migration {
        version: 13,
        name: "remove retired score column",
        sql: MIGRATION_13,
        pre_hook: None,
    },
    Migration {
        version: 14,
        name: "session CLI version and schema cleanup",
        sql: MIGRATION_14,
        pre_hook: None,
    },
    Migration {
        version: 15,
        name: "session_segments end_timestamp index",
        sql: MIGRATION_15,
        pre_hook: None,
    },
    Migration {
        version: 16,
        name: "observed AI Credit analytics",
        sql: MIGRATION_16,
        pre_hook: None,
    },
    Migration {
        version: 17,
        name: "prompt cache windows",
        sql: MIGRATION_17,
        pre_hook: None,
    },
    Migration {
        version: 18,
        name: "agent runs",
        sql: MIGRATION_18,
        pre_hook: None,
    },
    Migration {
        version: 19,
        name: "skill invocations",
        sql: MIGRATION_19,
        pre_hook: None,
    },
    Migration {
        version: 20,
        name: "agent messaging",
        sql: MIGRATION_20,
        pre_hook: None,
    },
    Migration {
        version: 21,
        name: "independent successful source snapshots",
        sql: "ALTER TABLE sessions ADD COLUMN source_fingerprint TEXT;
              ALTER TABLE sessions ADD COLUMN search_source_fingerprint TEXT;",
        pre_hook: None,
    },
    Migration {
        version: 22,
        name: "session source identity",
        // Existing rows are all Copilot sessions; the defaults backfill them.
        sql: "ALTER TABLE sessions ADD COLUMN source TEXT NOT NULL DEFAULT 'copilot';
              ALTER TABLE sessions ADD COLUMN parent_session_id TEXT;
              ALTER TABLE sessions ADD COLUMN role TEXT NOT NULL DEFAULT 'primary';
              ALTER TABLE sessions ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
              ALTER TABLE sessions ADD COLUMN source_format_version TEXT;
              CREATE INDEX IF NOT EXISTS idx_sessions_source ON sessions(source);",
        pre_hook: None,
    },
    Migration {
        version: 23,
        name: "native tool names",
        // Filled only by sources that normalize tool names; Copilot writes none.
        sql: "CREATE TABLE IF NOT EXISTS session_native_tool_calls (
                  session_id TEXT NOT NULL,
                  tool_name TEXT NOT NULL,
                  native_tool_name TEXT NOT NULL,
                  call_count INTEGER NOT NULL DEFAULT 0,
                  success_count INTEGER NOT NULL DEFAULT 0,
                  failure_count INTEGER NOT NULL DEFAULT 0,
                  PRIMARY KEY (session_id, tool_name, native_tool_name),
                  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
              );",
        pre_hook: None,
    },
    Migration {
        version: 24,
        name: "usd cost and native tool durations",
        // Provider-priced USD for sources that are not billed in AI Credits.
        // NULL means no figure, never $0; Copilot writes none.
        sql: "ALTER TABLE sessions ADD COLUMN cost_usd REAL;
              ALTER TABLE session_segments ADD COLUMN cost_usd REAL;
              ALTER TABLE session_model_metrics ADD COLUMN cost_usd REAL;
              ALTER TABLE session_native_tool_calls
                  ADD COLUMN total_duration_ms INTEGER NOT NULL DEFAULT 0;
              ALTER TABLE session_native_tool_calls
                  ADD COLUMN calls_with_duration INTEGER NOT NULL DEFAULT 0;",
        pre_hook: None,
    },
];

pub(super) static INDEX_DB_PLAN: MigrationPlan = MigrationPlan {
    migrations: INDEX_DB_MIGRATIONS,
};

#[cfg(test)]
mod tests {
    use super::{INDEX_DB_MIGRATIONS, INDEX_DB_PLAN};
    use rusqlite::Connection;
    use tracepilot_core::utils::migrator::{MigrationPlan, MigratorOptions, run_migrations};

    #[test]
    fn source_migration_backfills_existing_rows_as_copilot() {
        let at = INDEX_DB_MIGRATIONS
            .iter()
            .position(|m| m.version == 22)
            .expect("migration 22");
        let v21 = MigrationPlan {
            migrations: &INDEX_DB_MIGRATIONS[..at],
        };
        let mut conn = Connection::open_in_memory().expect("open in-memory db");
        run_migrations(&mut conn, None, &v21, &MigratorOptions::default()).expect("migrate to 21");
        conn.execute(
            "INSERT INTO sessions (id, path) VALUES ('s1', '/sessions/s1')",
            [],
        )
        .expect("insert v21 row");

        run_migrations(&mut conn, None, &INDEX_DB_PLAN, &MigratorOptions::default())
            .expect("migrate to 22");

        let row: (String, Option<String>, String, i64, Option<String>) = conn
            .query_row(
                "SELECT source, parent_session_id, role, hidden, source_format_version
                 FROM sessions WHERE id = 's1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
            )
            .expect("read migrated row");
        assert_eq!(row, ("copilot".into(), None, "primary".into(), 0, None));
    }

    #[test]
    fn index_db_plan_is_strictly_monotonic() {
        INDEX_DB_PLAN
            .validate()
            .expect("INDEX_DB_PLAN versions must be strictly monotonically increasing");
    }

    #[test]
    fn end_timestamp_range_query_uses_new_index() {
        let mut conn = Connection::open_in_memory().expect("open in-memory db");
        run_migrations(&mut conn, None, &INDEX_DB_PLAN, &MigratorOptions::default())
            .expect("apply migrations on a fresh in-memory db");

        let plan: Vec<String> = conn
            .prepare(
                "EXPLAIN QUERY PLAN \
                 SELECT session_id, total_tokens \
                 FROM session_segments \
                 WHERE end_timestamp >= ?1 AND end_timestamp < ?2",
            )
            .expect("prepare EXPLAIN QUERY PLAN")
            .query_map(["2026-01-01", "2026-02-01"], |row| row.get::<_, String>(3))
            .expect("query EXPLAIN QUERY PLAN rows")
            .collect::<Result<_, _>>()
            .expect("collect plan rows");

        let joined = plan.join("\n");
        assert!(
            joined.contains("idx_session_segments_end_ts"),
            "EXPLAIN QUERY PLAN should reference idx_session_segments_end_ts, got:\n{joined}"
        );
    }
}
