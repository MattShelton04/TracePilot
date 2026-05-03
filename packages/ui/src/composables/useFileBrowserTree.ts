/**
 * useFileBrowserTree — shared tree-structure logic for any FileEntry list.
 *
 * Used by both FileBrowserTree (session explorer) and SkillAssetsTree (skill
 * editor) so the grouping, sorting, collapse, and formatting code lives in one
 * place.
 */
import type { FileEntry } from "@tracepilot/types";
import { computed, type Ref, ref, watch } from "vue";
import { formatBytes } from "../utils/formatters";

export interface UseFileBrowserTreeOptions {
  /** Folders with more files than this are auto-collapsed on load. */
  autoCollapseThreshold?: number;
}

export interface FileBrowserFolderNode<TEntry extends FileEntry = FileEntry> {
  path: string;
  name: string;
  files: TEntry[];
  folders: FileBrowserFolderNode<TEntry>[];
  fileCount: number;
}

export type FileBrowserTreeRow<TEntry extends FileEntry = FileEntry> =
  | { kind: "file"; entry: TEntry; depth: number }
  | { kind: "folder"; folder: FileBrowserFolderNode<TEntry>; depth: number };

interface MutableFolderNode<TEntry extends FileEntry> {
  path: string;
  name: string;
  files: TEntry[];
  foldersByName: Map<string, MutableFolderNode<TEntry>>;
}

function splitPath(path: string): string[] {
  return path.split(/[\\/]+/).filter(Boolean);
}

function ensureFolder<TEntry extends FileEntry>(
  foldersByName: Map<string, MutableFolderNode<TEntry>>,
  parts: readonly string[],
): MutableFolderNode<TEntry> {
  let currentFolders = foldersByName;
  let current: MutableFolderNode<TEntry> | undefined;
  const fullPath: string[] = [];

  for (const part of parts) {
    fullPath.push(part);
    current = currentFolders.get(part);
    if (!current) {
      current = {
        path: fullPath.join("/"),
        name: part,
        files: [],
        foldersByName: new Map(),
      };
      currentFolders.set(part, current);
    }
    currentFolders = current.foldersByName;
  }

  if (!current) {
    throw new Error("Cannot create a folder node from an empty path");
  }
  return current;
}

function finalizeFolder<TEntry extends FileEntry>(
  folder: MutableFolderNode<TEntry>,
): FileBrowserFolderNode<TEntry> {
  const files = [...folder.files].sort((a, b) => a.name.localeCompare(b.name));
  const folders = [...folder.foldersByName.values()]
    .map(finalizeFolder)
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    path: folder.path,
    name: folder.name,
    files,
    folders,
    fileCount: files.length + folders.reduce((total, child) => total + child.fileCount, 0),
  };
}

function countFilesByFolder(entries: readonly FileEntry[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const parts = splitPath(entry.path);
    for (let depth = 1; depth < parts.length; depth += 1) {
      const folder = parts.slice(0, depth).join("/");
      counts.set(folder, (counts.get(folder) ?? 0) + 1);
    }
  }
  return counts;
}

function collectRows<TEntry extends FileEntry>(
  folder: FileBrowserFolderNode<TEntry>,
  depth: number,
  collapsedFolders: ReadonlySet<string>,
  rows: FileBrowserTreeRow<TEntry>[],
) {
  rows.push({ kind: "folder", folder, depth });
  if (collapsedFolders.has(folder.path)) return;

  for (const entry of folder.files) {
    rows.push({ kind: "file", entry, depth: depth + 1 });
  }
  for (const child of folder.folders) {
    collectRows(child, depth + 1, collapsedFolders, rows);
  }
}

export function useFileBrowserTree<TEntry extends FileEntry>(
  entries: Ref<readonly TEntry[]>,
  options: UseFileBrowserTreeOptions = {},
) {
  const collapsedFolders = ref<Set<string>>(new Set());
  const userToggledFolders = ref<Set<string>>(new Set());

  watch(
    entries,
    (list) => {
      if (!options.autoCollapseThreshold) return;
      const counts = countFilesByFolder(list);
      const next = new Set(collapsedFolders.value);
      for (const [folder, count] of counts.entries()) {
        // biome-ignore lint/style/noNonNullAssertion: this branch only runs when autoCollapseThreshold was provided by the caller.
        if (count > options.autoCollapseThreshold! && !userToggledFolders.value.has(folder)) {
          next.add(folder);
        }
      }
      collapsedFolders.value = next;
    },
    { immediate: true },
  );

  function toggleFolder(folder: string) {
    const next = new Set(collapsedFolders.value);
    userToggledFolders.value = new Set(userToggledFolders.value).add(folder);
    if (next.has(folder)) next.delete(folder);
    else next.add(folder);
    collapsedFolders.value = next;
  }

  const treeStructure = computed(() => {
    const foldersByName = new Map<string, MutableFolderNode<TEntry>>();
    const rootFiles: TEntry[] = [];

    for (const entry of entries.value) {
      const parts = splitPath(entry.path);
      if (parts.length === 0) continue;

      if (entry.isDirectory) {
        ensureFolder(foldersByName, parts);
      } else if (parts.length > 1) {
        ensureFolder(foldersByName, parts.slice(0, -1)).files.push(entry);
      } else {
        rootFiles.push(entry);
      }
    }

    rootFiles.sort((a, b) => a.name.localeCompare(b.name));
    const folders = [...foldersByName.values()]
      .map(finalizeFolder)
      .sort((a, b) => a.name.localeCompare(b.name));
    return { rootFiles, folders };
  });

  const visibleRows = computed(() => {
    const rows: FileBrowserTreeRow<TEntry>[] = treeStructure.value.rootFiles.map((entry) => ({
      kind: "file",
      entry,
      depth: 0,
    }));
    for (const folder of treeStructure.value.folders) {
      collectRows(folder, 0, collapsedFolders.value, rows);
    }
    return rows;
  });

  const fileCount = computed(() => entries.value.filter((e) => !e.isDirectory).length);

  return {
    treeStructure,
    visibleRows,
    fileCount,
    collapsedFolders,
    toggleFolder,
    formatSize: formatBytes,
  };
}
