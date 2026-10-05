//! Session sources behind one seam.
//!
//! Everything source-specific lives under this module. Consumers outside it
//! work on [`SessionLocator`]s, [`SourceFingerprint`]s and normalized
//! [`TypedEvent`](crate::parsing::events::TypedEvent)s, never on a source's
//! file layout.

mod types;

pub use types::{
    CostBasis, CostFigure, CostUnit, Liveness, NativeRecord, ProviderSnapshot, RunStatus,
    SessionArtifacts, SessionLocator, SessionMetrics, SessionRole, SessionSource,
    SourceCapabilities, SourceFingerprint, TodoList,
};

#[cfg(test)]
mod tests;
