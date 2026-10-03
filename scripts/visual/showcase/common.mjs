// Shared clock and deterministic randomness for the README showcase dataset.
// Every value is synthetic: fictional `acme/*` repositories and people-free
// content, generated identically on every run.

/** The showcase's "now". README cases pin the browser clock to this instant. */
export const SHOWCASE_NOW = "2026-09-30T14:20:00.000Z";
export const NOW_MS = Date.parse(SHOWCASE_NOW);
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** ISO timestamp `ms` milliseconds before the showcase's now. */
export const ago = (ms) => new Date(NOW_MS - ms).toISOString();

/** Deterministic PRNG (mulberry32) so generated history never changes. */
export function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = (random, items) => items[Math.floor(random() * items.length)];
export const between = (random, min, max) => Math.round(min + random() * (max - min));
export const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10);

export const HERO_SESSION_ID = "4f1c2a9e-7b3d-4e58-9a61-0c2f8d5e3b71";
export const HERO_CWD = "C:\\code\\acme\\checkout-web";
export const CLI_VERSION = "1.0.91";
