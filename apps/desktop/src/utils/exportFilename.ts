/**
 * Supported export extensions. Mirrors the formats currently produced by
 * `apps/desktop/src/components/export/ExportTab.vue`.
 *
 *   - `tpx.json` — TracePilot JSON export
 *   - `md`       — Markdown export
 *   - `csv`      — CSV export
 *   - `zip`      — Raw session folder archive
 */
export type ExportExtension = "tpx.json" | "md" | "csv" | "zip";

/**
 * Inputs for {@link buildExportFilename}. Both name fields are optional;
 * when neither yields a usable slug the function falls back to
 * `"session-export"`, matching the existing behaviour in `ExportTab.vue`.
 */
export interface BuildExportFilenameOptions {
  /** Primary candidate for the slug, e.g. session summary. */
  summary?: string | null;
  /** Secondary candidate, e.g. repository name. */
  repository?: string | null;
  /** Output file extension (without leading dot). */
  extension: ExportExtension;
  /**
   * Optional `Date` to stamp the filename with. Defaults to `new Date()`.
   * Exposed primarily so tests can pin the timestamp deterministically.
   */
  now?: Date;
}

const FALLBACK_SLUG = "session-export";
const MAX_SLUG_LENGTH = 60;

/**
 * Slugify a candidate string the same way `ExportTab.vue` does:
 *   - strip non-word/space/hyphen characters
 *   - collapse whitespace into single hyphens
 *   - lowercase
 *   - trim to {@link MAX_SLUG_LENGTH} characters
 */
function slugifyCandidate(value: string): string {
  return value
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase()
    .slice(0, MAX_SLUG_LENGTH);
}

/**
 * Build a default filename for a session export.
 *
 * Output shape: `<slug>-<YYYY-MM-DD-HH-mm>.<extension>`, matching the
 * existing logic in `ExportTab.vue` (ISO timestamp truncated to minute,
 * with `T` and `:` replaced by `-`).
 */
export function buildExportFilename(options: BuildExportFilenameOptions): string {
  const { summary, repository, extension, now } = options;
  const candidate = summary || repository || "";
  const slug = slugifyCandidate(candidate) || FALLBACK_SLUG;
  const stamp = (now ?? new Date()).toISOString().slice(0, 16).replace(/[T:]/g, "-");
  return `${slug}-${stamp}.${extension}`;
}
