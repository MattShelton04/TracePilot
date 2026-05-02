//! Index database migration plan and version order.

use super::columns::ensure_search_columns;
use super::sql::{
    MIGRATION_1, MIGRATION_2, MIGRATION_3, MIGRATION_4, MIGRATION_5, MIGRATION_6, MIGRATION_7,
    MIGRATION_8, MIGRATION_9, MIGRATION_10, MIGRATION_11, MIGRATION_13,
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
];

pub(super) static INDEX_DB_PLAN: MigrationPlan = MigrationPlan {
    migrations: INDEX_DB_MIGRATIONS,
};
