// Assertions in tests should fail immediately on invalid fixtures.
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]
//! Shared test-only helpers for the TracePilot workspace.
//!
//! This crate is consumed from `[dev-dependencies]` only; it centralises
//! fixtures and builders that would otherwise be duplicated across the
//! workspace's `#[cfg(test)]` modules and integration tests.
//!
//! See `docs/tech-debt-plan-revised-2026-04.md` §3-safety.5 for the
//! migration plan and rationale.

pub mod claude;
pub mod claude_scenarios;
pub mod copilot_corpus;
pub mod fixtures;
pub mod golden;
