//! Session summary builder — stable facade for summary loading.
//!
//! Reads workspace metadata, events, checkpoints, and session artifacts,
//! then assembles a [`SessionSummary`] with context enrichment from events.

mod artifacts;
mod enrichment;
mod loader;
mod model_calls;
mod snapshot;
#[cfg(test)]
mod tests;
mod types;
mod workspace;

pub use loader::{
    load_session_summary, load_session_summary_from_events, load_session_summary_with_events,
};
pub use snapshot::{SessionFingerprint, load_session_snapshot};
pub use types::SessionLoadResult;

pub use enrichment::summary_from_events;
pub use model_calls::metrics_from_model_calls;
