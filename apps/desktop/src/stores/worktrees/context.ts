import type { RegisteredRepo, WorktreeInfo } from "@tracepilot/types";
import type { AsyncGuard } from "@tracepilot/ui";
import type { Ref, ShallowRef } from "vue";

export type WorktreeSortField = "branch" | "status" | "createdAt" | "diskUsageBytes";
export type SortDirection = "asc" | "desc";

export interface WorktreesContext {
  worktrees: Ref<WorktreeInfo[]>;
  branches: ShallowRef<string[]>;
  loading: Ref<boolean>;
  error: Ref<string | null>;
  currentRepoPath: Ref<string>;
  registeredRepos: Ref<RegisteredRepo[]>;
  reposLoading: Ref<boolean>;
  loadGuard: AsyncGuard;
  branchGuard: AsyncGuard;
}
