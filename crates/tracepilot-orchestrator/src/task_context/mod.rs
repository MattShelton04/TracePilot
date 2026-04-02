//! Context assembly pipeline for AI agent tasks.
//!
//! Builds the complete context file (markdown) that a subagent reads to execute
//! a task. Combines preset prompts, rendered variables, context source data, and
//! output schema into a single `context.md` per task.

mod assembler;
mod budget;
mod sources;

pub use assembler::*;
pub use budget::Priority;
