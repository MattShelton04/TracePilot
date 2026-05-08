//! Service layer extracted from fat command modules.
//!
//! Commands in `crate::commands::*` remain the IPC surface (`#[tauri::command]`
//! / `#[specta::specta]`), but they now delegate orchestration, validation and
//! pure logic to module-level functions here. Service signatures take plain
//! refs/values (`&SharedConfig`, `Arc<IndexingSemaphores>`, …) instead of
//! `tauri::State<'_, T>`, so they are unit-testable and can be reused across
//! commands.

pub(crate) mod app_info;
pub(crate) mod config;
pub(crate) mod update;
