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
