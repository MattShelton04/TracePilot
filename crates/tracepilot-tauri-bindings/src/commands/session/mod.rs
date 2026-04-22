//! Session-related Tauri commands (12 commands).
//!
//! Split into focused submodules by concern. Glob re-exports below preserve
//! the original `commands::session::<command_name>` paths in `lib.rs` so
//! `tauri::generate_handler!` compiles unchanged.
//!
//! **Important**: `pub use <submod>::*;` is required rather than explicit
//! re-exports because each `#[tauri::command]` attribute expands to a hidden
//! `__cmd__<command_name>` item that must be reachable at the same path as
//! the command function. Glob re-exports forward both.

mod artifacts;
mod detail;
mod events;
mod list;
mod resume;
mod shared;
mod turns;

#[cfg(test)]
mod tests;

pub use artifacts::*;
pub use detail::*;
pub use events::*;
pub use list::*;
pub use resume::*;
pub use turns::*;
