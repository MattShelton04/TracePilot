//! Tauri IPC commands for the AI agent task system.
//!
//! Split by domain for maintainability:
//!   - `crud`             – Task and Job CRUD operations
//!   - `presets`          – Task preset management
//!   - `orchestrator`     – Orchestrator lifecycle (health / start / stop)
//!   - `ingestion`        – Result ingestion with auto-retry
//!   - `attribution`      – Session ↔ task attribution
//!   - `manifest_helpers` – Shared building blocks for manifest hot-add

mod attribution;
mod crud;
mod ingestion;
mod manifest_helpers;
mod orchestrator;
mod presets;

// Glob re-exports so that Tauri's generated `__cmd__*` items (created by
// the `#[tauri::command]` proc-macro) are visible at `commands::tasks::*`.
// `tauri::generate_handler!` resolves these items by path, so they must
// be re-exported alongside the public command functions.
pub use attribution::*;
pub use crud::*;
pub use ingestion::*;
pub use orchestrator::*;
pub use presets::*;
