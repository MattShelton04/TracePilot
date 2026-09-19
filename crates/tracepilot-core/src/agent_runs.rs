//! Per-invocation agent runs derived from reconstructed session state.
//!
//! The turn reconstructor already resolves subagent identity (launching tool
//! call vs. runtime instance), multi-turn workers, delayed completions and
//! parent/child nesting. This module reads that reconstructed state instead
//! of re-deriving it from raw events, and adds only the per-run metadata the
//! reconstructor does not keep (1.0.83 dispatch and configuration fields,
//! exclusive credits from the `agentMetrics` ledger, follow-up messages and
//! sibling parallelism). It powers the cross-session Agents explorer.
//!
//! Accounting rules inherited from the per-session subagent analysis:
//! - `total_tokens` from `subagent.completed` can include descendants; it is
//!   stored as reported and must never be summed across a hierarchy.
//! - Exclusive credits come only from the shutdown `agentMetrics` ledger.
//! - Outcomes use the reconstructed status, not raw terminal-event counts.

mod extract;
mod model;

pub use extract::extract_agent_runs;
pub use model::{AgentRun, AgentRunExtraction, AgentRunOutcome, AgentRunSource, AgentSelection};

#[cfg(test)]
mod tests;
