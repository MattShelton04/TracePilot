//! Per-invocation skill usage derived from reconstructed session state.
//!
//! The Skills manager knows what is *installed*. This module records what was
//! *used*: one row per invocation, with enough context to say who invoked it,
//! from where, at what cost, and whether the skill has changed since.
//!
//! It reads the reconstructed turns rather than re-deriving turn boundaries,
//! so `turn_index` and agent ownership match the Conversation tab, and adds
//! only what the reconstructor does not keep: the 1.0.49+ `source`/`trigger`
//! fields, the envelope `agentId`, plugin metadata, a content fingerprint and
//! token estimates.
//!
//! Coverage rules inherited from the corpus this was built against:
//! - `trigger` exists on a small minority of invocations. It is stored as
//!   recorded and reported as unknown otherwise — never split by guesswork.
//! - Some `skill` tool calls have no `skill.invoked` event. They become
//!   fallback rows: name only, with no path, fingerprint or token estimate.
//! - Content is fingerprinted with line endings normalised, because the same
//!   file read from disk on Windows and echoed through a session log differs
//!   by CRLF alone.

mod extract;
mod model;

pub use extract::extract_skill_invocations;
pub use model::{
    SkillInvocation, SkillInvocationOrigin, normalize_skill_directory, normalize_skill_name,
};

#[cfg(test)]
mod tests;
