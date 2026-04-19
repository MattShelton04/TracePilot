/**
 * useFileBrowserTree — shared tree-structure logic for any FileEntry list.
 *
 * Used by both FileBrowserTree (session explorer) and SkillAssetsTree (skill
 * editor) so the grouping, sorting, collapse, and formatting code lives in one
 * place.
 */
import type { FileEntry } from "@tracepilot/types";
import { computed, ref, watch, type Ref } from "vue";

export interface UseFileBrowserTreeOptions {
  /** Folders with more files than this are auto-collapsed on load. */
  autoCollapseThreshold?: number;
}

export function useFileBrowserTree(
  entries: Ref<readonly FileEntry[]>,
  options: UseFileBrowserTreeOptions = {},
) {
  const collapsedFolders = ref<Set<string>>(new Set());
  const userToggledFolders = ref<Set<string>>(new Set());

  watch(
    entries,
    (list) => {
      if (!options.autoCollapseThreshold) return;
      const counts: Record<string, number> = {};
      for (const entry of list) {
        if (entry.isDirectory) continue;
        const parts = entry.path.split("/");
        if (parts.length > 1) {
          const folder = parts.slice(0, -1).join("/");
          counts[folder] = (counts[folder] ?? 0) + 1;
        }
      }
      const next = new Set(collapsedFolders.value);
      for (const [folder, count] of Object.entries(counts)) {
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
    const folders: Record<string, FileEntry[]> = {};
    const rootFiles: FileEntry[] = [];
    for (const entry of entries.value) {
      if (entry.isDirectory) continue;
      const parts = entry.path.split("/");
      if (parts.length > 1) {
        const folder = parts.slice(0, -1).join("/");
        if (!folders[folder]) folders[folder] = [];
        folders[folder].push(entry);
      } else {
        rootFiles.push(entry);
      }
    }
    rootFiles.sort((a, b) => a.name.localeCompare(b.name));
    for (const key of Object.keys(folders)) {
      folders[key].sort((a, b) => a.name.localeCompare(b.name));
    }
    return { rootFiles, folders };
  });

  const fileCount = computed(() => entries.value.filter((e) => !e.isDirectory).length);

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return { treeStructure, fileCount, collapsedFolders, toggleFolder, formatSize };
}
