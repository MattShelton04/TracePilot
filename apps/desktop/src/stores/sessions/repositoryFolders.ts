/**
 * Which repository a working folder belongs to, learned from the sessions
 * that name one.
 *
 * Claude Code records a repository only from git-origin data, so many of its
 * sessions carry just a working directory. When a session that names a
 * repository ran in the same folder, the session list files the folder-only
 * sessions under that repository too. Each clone of a repository folds in on
 * its own evidence, so several clones merge under one repository.
 *
 * Only an exact folder match counts. A subfolder can be a clone of its own (a
 * dotfiles repository at home, a nested checkout), and list items carry no git
 * root to tell the two apart. A folder where sessions name different
 * repositories is ambiguous and stays a folder.
 */
import type { SessionListItem } from "@tracepilot/types";

/** Folder → its repository, or `null` when sessions there name more than one. */
export type FolderRepositories = ReadonlyMap<string, string | null>;

const WINDOWS_PATH = /^(?:[a-z]:(?:\/|$)|\/\/)/i;

/**
 * A comparable identity for a working directory: separators unified, repeated
 * and trailing ones dropped, the `\\?\` prefix removed, and Windows paths
 * (drive letter or UNC) case-folded. POSIX paths keep their case.
 */
export function folderKey(cwd: string | null | undefined): string | null {
  let path = cwd?.trim().replace(/\\/g, "/");
  if (!path) return null;
  if (path.startsWith("//?/UNC/")) path = `//${path.slice(8)}`;
  else if (path.startsWith("//?/")) path = path.slice(4);
  const unc = path.startsWith("//");
  path = path.replace(/\/{2,}/g, "/").replace(/\/+$/, "");
  if (unc) path = `/${path}`;
  if (!path || /^[a-z]:$/i.test(path)) path = `${path}/`;
  return WINDOWS_PATH.test(path) ? path.toLowerCase() : path;
}

/** The repository each folder belongs to, from the sessions that name one. */
export function folderRepositories(sessions: readonly SessionListItem[]): FolderRepositories {
  const folders = new Map<string, string | null>();
  for (const s of sessions) {
    if (!s.repository) continue;
    const key = folderKey(s.cwd);
    if (!key) continue;
    const known = folders.get(key);
    if (known === undefined) folders.set(key, s.repository);
    else if (known !== null && known !== s.repository) folders.set(key, null);
  }
  return folders;
}

/**
 * The repository a repository-less session belongs to through its folder, or
 * `null` when the session names its own, has no folder, or the folder is
 * unknown or ambiguous.
 */
export function folderRepository(s: SessionListItem, folders: FolderRepositories): string | null {
  if (s.repository) return null;
  const key = folderKey(s.cwd);
  return key ? (folders.get(key) ?? null) : null;
}
