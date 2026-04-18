// Shared helpers for the VRT harness. Kept intentionally small — the
// Playwright CT `playwright/index.ts` entry is responsible for loading
// design tokens and the deterministic style reset.
export const SNAPSHOT_OPTS = { maxDiffPixels: 50 } as const;
