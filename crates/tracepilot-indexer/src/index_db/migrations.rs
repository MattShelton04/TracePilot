//! Schema migrations for the index database.

mod columns;
mod plan;
mod runner;
mod sql;

pub(super) use runner::run_migrations;
