/**
 * Composable for Git repository operations.
 *
 * Provides reactive state and methods for common Git operations:
 * - Loading default branch
 * - Fetching from remote
 * - Computing worktree paths from branch names
 *
 * Extracted from SessionLauncherView and WorktreeManagerView to eliminate
 * ~150 lines of duplicated code and provide a single source of truth.
 */

import { fetchRemote, getDefaultBranch } from "@tracepilot/client";
import { pathBasename, pathDirname, sanitizeBranchForPath } from "@tracepilot/ui";
import type { Ref } from "vue";
import { ref, watch } from "vue";
import { logWarn } from "@/utils/logger";
import { useAsyncGuard } from "./useAsyncGuard";

export interface UseGitRepositoryOptions {
  /**
   * Repository path to operate on (reactive).
   * When this changes, default branch is automatically reloaded.
   */
  repoPath: Ref<string>;

  /**
   * Optional callback when fetch succeeds.
   * Called after remote fetch completes successfully.
   */
  onFetchSuccess?: () => void;

  /**
   * Optional callback when fetch fails.
   * Receives the error message as a parameter.
   */
  onFetchError?: (error: string) => void;
}

export interface UseGitRepositoryReturn {
  /**
   * Default branch name (e.g., "main", "master").
   * Automatically loaded when repoPath changes.
   */
  defaultBranch: Ref<string>;

  /**
   * Whether a fetch operation is currently in progress.
   */
  fetchingRemote: Ref<boolean>;

  /**
   * Manually reload the default branch for the current repoPath.
   * Useful for refreshing after external changes.
   */
  loadDefaultBranch: () => Promise<void>;

  /**
   * Fetch latest changes from remote.
   * Sets loading state and calls appropriate callbacks.
   */
  fetchRemote: () => Promise<void>;

  /**
   * Compute worktree path from branch name.
   *
   * Generates a path in the format: `{parent}/{repoName}-{sanitizedBranch}`
   * where special characters in the branch name are sanitized.
   *
   * @param branchName - Branch name to compute path for
   * @returns Computed worktree path, or empty string if inputs are invalid
   */
  computeWorktreePath: (branchName: string) => string;
}

/**
 * Composable for Git repository operations.
 *
 * @example
 * ```typescript
 * const repoPath = ref('/path/to/repo');
 *
 * const {
 *   defaultBranch,
 *   fetchingRemote,
 *   fetchRemote,
 *   computeWorktreePath,
 * } = useGitRepository({
 *   repoPath,
 *   onFetchSuccess: () => {
 *     console.log('Fetch succeeded!');
 *   },
 *   onFetchError: (error) => {
 *     console.error('Fetch failed:', error);
 *   },
 * });
 *
 * // Default branch is automatically loaded when repoPath changes
 * console.log(defaultBranch.value); // "main"
 *
 * // Fetch from remote
 * await fetchRemote();
 *
 * // Compute worktree path
 * const path = computeWorktreePath('feature/new-feature');
 * // "/path/to/repo-feature-new-feature"
 * ```
 */
export function useGitRepository(options: UseGitRepositoryOptions): UseGitRepositoryReturn {
  const { repoPath, onFetchSuccess, onFetchError } = options;

  const defaultBranch = ref("");
  const fetchingRemote = ref(false);
  const defaultBranchGuard = useAsyncGuard();
  const fetchGuard = useAsyncGuard();

  // Auto-load default branch when repoPath changes
  watch(
    repoPath,
    async (newPath) => {
      defaultBranchGuard.invalidate();
      fetchGuard.invalidate();
      defaultBranch.value = "";
      fetchingRemote.value = false;

      if (newPath) {
        await loadDefaultBranchForPath(newPath);
      }
    },
    { immediate: true },
  );

  async function loadDefaultBranchForPath(targetPath: string) {
    if (!targetPath) {
      defaultBranch.value = "";
      return;
    }

    const token = defaultBranchGuard.start();
    try {
      const branch = await getDefaultBranch(targetPath);
      if (!defaultBranchGuard.isValid(token)) return;
      defaultBranch.value = branch;
    } catch (e) {
      if (!defaultBranchGuard.isValid(token)) return;
      // Silently fail - some repos might not have a default branch configured
      logWarn("[useGitRepository] Failed to get default branch", { repoPath: repoPath.value }, e);
      defaultBranch.value = "";
    }
  }

  async function loadDefaultBranch() {
    await loadDefaultBranchForPath(repoPath.value);
  }

  async function fetchRemoteImpl() {
    const targetPath = repoPath.value;
    if (!targetPath) return;

    const token = fetchGuard.start();
    fetchingRemote.value = true;
    try {
      await fetchRemote(targetPath);
      if (!fetchGuard.isValid(token)) return;
      onFetchSuccess?.();
    } catch (error) {
      if (!fetchGuard.isValid(token)) return;
      const message = error instanceof Error ? error.message : String(error);
      onFetchError?.(message);
    } finally {
      if (fetchGuard.isValid(token)) {
        fetchingRemote.value = false;
      }
    }
  }

  function computeWorktreePath(branchName: string): string {
    if (!repoPath.value || !branchName) return "";

    const repoName = pathBasename(repoPath.value);
    const parent = pathDirname(repoPath.value);
    const sanitized = sanitizeBranchForPath(branchName);

    return `${parent}/${repoName}-${sanitized}`;
  }

  return {
    defaultBranch,
    fetchingRemote,
    loadDefaultBranch,
    fetchRemote: fetchRemoteImpl,
    computeWorktreePath,
  };
}
