import type { RegisteredRepo, WorktreeInfo } from "@tracepilot/types";
import type { SortDirection, WorktreeSortField } from "./context";

export function sortWorktrees(
  worktrees: WorktreeInfo[],
  sortBy: WorktreeSortField,
  sortDirection: SortDirection,
): WorktreeInfo[] {
  const sorted = [...worktrees];
  const dir = sortDirection === "asc" ? 1 : -1;
  sorted.sort((a, b) => {
    switch (sortBy) {
      case "branch":
        return dir * a.branch.localeCompare(b.branch);
      case "status":
        return dir * a.status.localeCompare(b.status);
      case "createdAt":
        return dir * ((a.createdAt ?? "") < (b.createdAt ?? "") ? -1 : 1);
      case "diskUsageBytes":
        return dir * ((a.diskUsageBytes ?? 0) - (b.diskUsageBytes ?? 0));
      default:
        return 0;
    }
  });
  return sorted;
}

export function sortRegisteredRepos(repos: RegisteredRepo[]): RegisteredRepo[] {
  return [...repos].sort((a, b) => {
    if (a.favourite && !b.favourite) return -1;
    if (!a.favourite && b.favourite) return 1;
    return a.name.localeCompare(b.name);
  });
}
