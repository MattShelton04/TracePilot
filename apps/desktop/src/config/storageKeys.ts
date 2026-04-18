/**
 * Canonical registry of `localStorage` keys used by the desktop app.
 *
 * Single source of truth — every call site that reads or writes a persisted
 * browser-storage key in `apps/desktop/src/**` should import `STORAGE_KEYS`
 * rather than repeating the raw string.
 *
 * ## Convention
 *
 * All keys must start with the `tracepilot` namespace. Historically two
 * spellings coexist:
 *
 * - `tracepilot-<name>` (dash) — used by preference/theme/update keys.
 * - `tracepilot:<name>` (colon) — used by newer store-owned data (SDK
 *   settings, session tabs, alert history).
 *
 * New keys should prefer the `tracepilot-` dash form for consistency with
 * `routes.ts`/`sidebarIds.ts` style. Existing colon-form keys are preserved
 * verbatim to keep persisted data loadable on existing user machines — any
 * future rename must go through `storageKeysMigration.ts`.
 *
 * See Phase 1B.2 in `docs/tech-debt-plan-revised-2026-04.md`.
 */

export const STORAGE_KEYS = Object.freeze({
  /** Write-through cache for the selected UI theme; read before Vue mounts. */
  theme: "tracepilot-theme",
  /** ID of the last session the user viewed (ephemeral). */
  lastSession: "tracepilot-last-session",
  /** Version the user has last seen, used to gate "what's new" banners. */
  lastSeenVersion: "tracepilot-last-seen-version",
  /** Legacy combined-preferences blob; read-only, removed after migration. */
  legacyPrefs: "tracepilot-prefs",
  /** Cached update-check result (24h TTL). */
  updateCheck: "tracepilot-update-check",
  /** Version string the user dismissed in the update banner. */
  dismissedUpdate: "tracepilot-dismissed-update",
  /** SDK bridge settings (CLI URL + log level). */
  sdkSettings: "tracepilot:sdk-settings",
  /** Open session tabs + active tab id. */
  sessionTabs: "tracepilot:session-tabs",
  /** Alert history ring buffer (up to 100 entries). */
  alerts: "tracepilot:alert-history",
} as const);

/** Narrowed union of valid `localStorage` keys used by the desktop app. */
export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];
