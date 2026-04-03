//! Helper macro for Tauri commands that are entirely a blocking `Result`-returning operation.
//!
//! Use this only as the tail expression of a command returning `CmdResult<T>`.
//! Intermediate bindings or infallible expressions should keep the explicit
//! `spawn_blocking(...).await?` form for clearer typing.

/// Execute a blocking `Result`-returning expression in `spawn_blocking`.
///
/// Expands to `Ok(tokio::task::spawn_blocking(move || expr).await??)`.
#[macro_export]
macro_rules! blocking_cmd {
    ($expr:expr) => {
        Ok(tokio::task::spawn_blocking(move || $expr).await??)
    };
}
