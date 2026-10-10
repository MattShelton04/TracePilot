/**
 * Shared path normalization utilities.
 *
 * Centralizes common path operations (backslash→forward slash, trailing slash removal)
 * used across multiple Vue views and stores.
 */

/** Normalize a path to forward slashes and strip trailing slash. */
export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

/** Extract the last segment (file/directory name) from a path. */
export function pathBasename(path: string): string {
  const parts = normalizePath(path).split("/");
  return parts[parts.length - 1] || "";
}

function isPathSeparator(ch: string): boolean {
  return ch === "/" || ch === "\\";
}

/** Bounds of the last segment, ignoring trailing separators. Linear scan, no regex. */
function lastSegmentBounds(path: string): { start: number; end: number } {
  let end = path.length;
  while (end > 0 && isPathSeparator(path[end - 1])) end -= 1;
  let start = end;
  while (start > 0 && !isPathSeparator(path[start - 1])) start -= 1;
  return { start, end };
}

/**
 * Split a path before its last segment, keeping every character:
 * `C:\a\b\` → `{ head: "C:\a\", tail: "b\" }`.
 */
export function splitLastPathSegment(path: string): { head: string; tail: string } {
  const { start } = lastSegmentBounds(path);
  return { head: path.slice(0, start), tail: path.slice(start) };
}

/**
 * A short project name for a working directory: its last path segment, or
 * the trimmed path itself for a root such as `/`. `null` when there is no
 * directory.
 */
export function projectLabelFromCwd(cwd: string | null | undefined): string | null {
  const trimmed = cwd?.trim();
  if (!trimmed) return null;
  const { start, end } = lastSegmentBounds(trimmed);
  return trimmed.slice(start, end) || trimmed;
}

/** Return all but the last segment (parent directory). */
export function pathDirname(path: string): string {
  const parts = normalizePath(path).split("/");
  return parts.slice(0, -1).join("/");
}

/** Shorten a path for display by showing only the last N segments. */
export function shortenPath(path: string, segments = 2): string {
  if (!path) return "";
  const parts = normalizePath(path).split("/");
  return parts.length > segments ? `…/${parts.slice(-segments).join("/")}` : path;
}

/**
 * Sanitize a git branch name into a safe filesystem-friendly string.
 * Replaces characters forbidden in most filesystems / git ref names.
 */
export function sanitizeBranchForPath(branch: string): string {
  return branch
    .trim()
    .replace(/[/\s~^:?*[\]\\<>|"]/g, "-")
    .replace(/\.\./g, "-")
    .replace(/-+/g, "-");
}
