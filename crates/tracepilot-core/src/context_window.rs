//! Context-window pressure reconstruction from Copilot CLI event telemetry.
//!
//! Copilot records exact layer totals at compaction boundaries and shutdown,
//! but it does not record a prompt snapshot for every turn. This module keeps
//! that distinction explicit: anchor points are observed, while points between
//! anchors are calibrated estimates derived from context-bearing event text.

mod builder;
mod contributions;
mod model;
mod points;

pub use builder::build_context_timeline;
pub use model::{
    ContextCompaction, ContextPointPhase, ContextPointSource, ContextTimeline,
    ContextTimelineEvent, ContextTimelineEventKind, ContextToolCallContribution,
    ContextToolTypeContribution, ContextWindowPoint,
};

#[cfg(test)]
use contributions::{context_result_content, finish_tool_contributions};
#[cfg(test)]
use model::ToolCallDraft;

#[cfg(test)]
mod tests;
