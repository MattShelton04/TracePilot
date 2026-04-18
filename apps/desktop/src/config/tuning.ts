/**
 * Cross-cutting runtime tuning constants.
 *
 * Only constants that are **shared across multiple files** live here.
 * Component-local timings (animation durations, single-use throttles)
 * stay next to their one caller to preserve cohesion.
 *
 * See Phase 1B.2 in `docs/tech-debt-plan-revised-2026-04.md`.
 */

// ─── Orchestrator polling ────────────────────────────────────────
/** Full-cycle orchestrator status poll while a run is active. */
export const POLL_FAST_MS = 5_000;
/** Health-only orchestrator status poll while idle. */
export const POLL_SLOW_MS = 15_000;

// ─── SDK event stream ────────────────────────────────────────────
/** Max `recentEvents` retained in the SDK store — older ones get trimmed. */
export const MAX_SDK_EVENTS = 500;
