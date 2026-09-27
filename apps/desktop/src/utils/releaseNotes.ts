import type { ReleaseManifestEntry } from "@tracepilot/types";

/** Parse `1.2.3`, `v1.2.3` or `1.2.3-beta.1` into numeric parts; `null` for anything else (e.g. "dev"). */
export function parseVersion(version: string | null | undefined): number[] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version?.trim() ?? "");
  return match ? match.slice(1, 4).map(Number) : null;
}

function compareParts(a: number[], b: number[]): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

/**
 * Manifest entries newer than `previous` and no newer than `current`, newest first.
 *
 * An unparseable `previous` (e.g. a dev build) shows only `current`, rather
 * than every release ever made. An unparseable `current` has no upper bound.
 */
export function entriesInRange(
  entries: readonly ReleaseManifestEntry[],
  previous: string,
  current: string,
): ReleaseManifestEntry[] {
  const lower = parseVersion(previous);
  const upper = parseVersion(current);
  return entries
    .map((entry) => ({ entry, parts: parseVersion(entry.version) }))
    .filter(({ parts }) => {
      if (!parts) return false;
      if (upper && compareParts(parts, upper) > 0) return false;
      if (lower) return compareParts(parts, lower) > 0;
      return upper ? compareParts(parts, upper) === 0 : true;
    })
    .sort((a, b) => compareParts(b.parts as number[], a.parts as number[]))
    .map(({ entry }) => entry);
}

/** `v1.2.3` for release versions; other builds (e.g. "dev") are shown as-is. */
export function displayVersion(version: string): string {
  return parseVersion(version) ? `v${version.replace(/^v/, "")}` : version;
}

/**
 * Split a manifest note written as `Title: description` so the title can be
 * emphasised. Notes without a short leading title are returned whole.
 */
export function splitReleaseNote(note: string): { title: string | null; body: string } {
  const index = note.indexOf(": ");
  if (index <= 0 || index > 80) return { title: null, body: note };
  return { title: note.slice(0, index), body: note.slice(index + 2) };
}
