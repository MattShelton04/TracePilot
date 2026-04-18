//! Shared test-only helpers for the TracePilot workspace.
//!
//! This crate is consumed from `[dev-dependencies]` only; it centralises
//! fixtures and builders that would otherwise be duplicated across the
//! workspace's `#[cfg(test)]` modules and integration tests.
//!
//! See `docs/tech-debt-plan-revised-2026-04.md` §3-safety.5 for the
//! migration plan and rationale.

pub mod fixtures;
