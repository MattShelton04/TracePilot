//! Generic helper for Tauri commands that run blocking operations.
//!
//! Provides a macro to eliminate the boilerplate of wrapping blocking operations
//! in `tokio::task::spawn_blocking` and handling the double-? error conversion.
//!
//! ## Rationale
//!
//! Many Tauri commands follow an identical pattern:
//!
//! ```ignore
//! #[tauri::command]
//! pub async fn some_command(param: String) -> CmdResult<ReturnType> {
//!     Ok(tokio::task::spawn_blocking(move || {
//!         // actual blocking operation
//!         do_something(param)
//!     })
//!     .await??)
//! }
//! ```
//!
//! This pattern appears 50+ times across command modules, creating maintenance
//! burden and obscuring the actual business logic.
//!
//! ## Solution
//!
//! The `blocking_cmd!` macro encapsulates this pattern:
//!
//! ```ignore
//! #[tauri::command]
//! pub async fn some_command(param: String) -> CmdResult<ReturnType> {
//!     blocking_cmd!(do_something(param))
//! }
//! ```
//!
//! This provides:
//! - **Reduced boilerplate**: 4-5 lines → 1 line per command
//! - **Clearer intent**: The blocking operation is immediately visible
//! - **Centralized pattern**: Future changes need only update the macro
//! - **Consistency**: All commands use the same async wrapper pattern
//!
//! ## Error Handling
//!
//! The macro preserves the double-? pattern:
//! - First `?` handles `JoinError` from the spawned task panicking
//! - Second `?` propagates the `Result<T, E>` from the blocking operation
//!
//! This ensures identical error semantics to the manual pattern.
//!
//! ## Usage Example
//!
//! ```ignore
//! use crate::blocking_cmd;
//! use crate::error::CmdResult;
//!
//! #[tauri::command]
//! pub async fn list_items() -> CmdResult<Vec<Item>> {
//!     blocking_cmd!(load_items_from_disk())
//! }
//!
//! #[tauri::command]
//! pub async fn get_item(id: String) -> CmdResult<Item> {
//!     blocking_cmd!(find_item(&id))
//! }
//!
//! // With error conversion helpers
//! fn sk<T>(r: Result<T, SkillsError>) -> Result<T, OrchestratorError> {
//!     r.map_err(OrchestratorError::from)
//! }
//!
//! #[tauri::command]
//! pub async fn create_skill(name: String) -> CmdResult<Skill> {
//!     blocking_cmd!(sk(orchestrator::create_skill(&name)))
//! }
//! ```
//!
//! ## When NOT to Use
//!
//! Don't use this macro for:
//! - Commands with custom caching logic before/after the blocking operation
//! - Commands that mix async and blocking operations
//! - Commands that need special error handling beyond the double-?
//! - **Commands where the operation returns `T` directly (not `Result<T, E>`)**
//!
//! In those cases, use the manual pattern for clarity.
//!
//! ## Requirements
//!
//! The expression passed to `blocking_cmd!` must:
//! - **Return `Result<T, E>`** where `E` implements `Into<BindingsError>`
//! - Be `Send + 'static` (can be safely moved to a blocking thread)
//! - Not contain `.await` (runs in a blocking context, not async)
//!
//! ## Panics
//!
//! If the expression panics inside the blocking task, the panic is caught and
//! converted to `JoinError`, which is then converted to `BindingsError::Join`.

/// Execute a blocking operation in a Tokio blocking task.
///
/// This macro wraps the common pattern of spawning a blocking task and awaiting
/// its result with proper error handling.
///
/// # Expansion
///
/// ```ignore
/// blocking_cmd!(expr)
/// ```
///
/// expands to:
///
/// ```ignore
/// Ok(tokio::task::spawn_blocking(move || expr).await??)
/// ```
///
/// # Examples
///
/// Simple blocking operation:
///
/// ```ignore
/// blocking_cmd!(load_config())
/// ```
///
/// With error conversion:
///
/// ```ignore
/// blocking_cmd!(sk(skills::create("name")))
/// ```
///
/// With complex expressions:
///
/// ```ignore
/// blocking_cmd!({
///     validate_input(&param)?;
///     process_data(&param)
/// })
/// ```
#[macro_export]
macro_rules! blocking_cmd {
    ($expr:expr) => {
        Ok(tokio::task::spawn_blocking(move || $expr).await??)
    };
}
