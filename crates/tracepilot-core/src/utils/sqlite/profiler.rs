/// Attach a debug-only slow-query profiler to a SQLite connection.
///
/// In debug builds, logs any query that takes longer than 10ms via
/// `tracing::warn!` with the given `label` attached to disambiguate which
/// database the slow query belongs to (e.g. `"index"`, `"tasks"`). In
/// release builds this is a compile-time no-op so there is no runtime cost.
///
/// Consolidates the duplicated `conn.profile(...)` blocks that previously
/// lived in `tracepilot-indexer` and `tracepilot-orchestrator`.
///
/// Implemented as a macro because `rusqlite::Connection::profile` accepts
/// only a non-capturing `fn` pointer; the macro inlines a dedicated
/// monomorphic callback per call-site with the literal label baked in.
///
/// # Arguments
/// * `$conn` - Mutable reference to an open SQLite connection
/// * `$label` - String literal tag recorded on every slow-query log line
#[macro_export]
macro_rules! attach_slow_query_profiler {
    ($conn:expr, $label:literal) => {{
        #[cfg(debug_assertions)]
        {
            fn __tracepilot_slow_query_cb(query: &str, duration: ::std::time::Duration) {
                if duration.as_millis() > 10 {
                    ::tracing::warn!(
                        duration_ms = duration.as_millis(),
                        query = %query.chars().take(200).collect::<::std::string::String>(),
                        db = $label,
                        "Slow SQL query"
                    );
                }
            }
            $conn.profile(::std::option::Option::Some(__tracepilot_slow_query_cb));
        }
        #[cfg(not(debug_assertions))]
        {
            let _ = (&$conn, $label);
        }
    }};
}
