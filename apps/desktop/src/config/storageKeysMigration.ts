/**
 * One-shot `localStorage` migration runner.
 *
 * Called from `main.ts` before any store setup or cached-theme read, so
 * downstream code can assume keys are in their canonical `STORAGE_KEYS`
 * form. The current wave does **not** rename any keys — this file is the
 * scaffold for future renames so we never hand-roll migrations ad-hoc
 * in call sites again.
 *
 * The function is idempotent: running it twice must not corrupt state.
 *
 * See Phase 1B.2 in `docs/tech-debt-plan-revised-2026-04.md`.
 */

import { STORAGE_KEYS } from "./storageKeys";

/**
 * Runs any pending `localStorage` key migrations.
 *
 * Safe to call on a fresh storage (no-op) and safe to call multiple times.
 */
export function runStorageKeyMigrations(): void {
  if (typeof localStorage === "undefined") return;

  // Dev-only self-check: make sure no two logical keys share the same raw
  // storage string. Mis-typed duplicates would silently clobber data on
  // first write.
  if (import.meta.env.DEV) {
    const values = Object.values(STORAGE_KEYS);
    const unique = new Set(values);
    if (unique.size !== values.length) {
      const counts = new Map<string, number>();
      for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
      const dupes = [...counts.entries()].filter(([, n]) => n > 1).map(([k]) => k);
      // eslint-disable-next-line no-console
      console.error(
        `[storageKeysMigration] duplicate STORAGE_KEYS values detected: ${dupes.join(", ")}`,
      );
    }
  }

  // add migrations here as keys are renamed
}
