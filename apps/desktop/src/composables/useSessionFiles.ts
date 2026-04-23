import { sessionListFiles, sessionReadFile, sessionReadSqlite } from "@tracepilot/client";
import type { SessionDbTable, SessionFileEntry, SessionFileType } from "@tracepilot/types";
import { ref, watch } from "vue";

export interface SessionFilesState {
  files: Readonly<SessionFileEntry[]>;
  filesLoading: boolean;
  filesError: string | null;
  selectedPath: string | null;
  selectedFileType: SessionFileType | null;
  fileContent: string | null;
  fileContentLoading: boolean;
  fileContentError: string | null;
  dbData: SessionDbTable[] | null;
  dbDataLoading: boolean;
  dbDataError: string | null;
  /** Newly-seen file paths since the last reload — transient, cleared by `ackNewPaths()`. */
  newFilePaths: Readonly<Set<string>>;
  /**
   * When a file is open in the viewer, tracks whether its content changed on the
   * last silent refresh. Transient; cleared by `ackContentChanged()`.
   */
  contentChangedAt: number | null;
  selectFile: (path: string, fileType: SessionFileType) => Promise<void>;
  /**
   * Reload files + (if a file is open) refetch its content in place.
   *
   * @param opts.silent When true (default for auto-refresh), skips toggling
   *   `filesLoading`/`fileContentLoading`/`dbDataLoading` so the DOM stays
   *   mounted and scroll position / focus are preserved. The file content
   *   ref is only swapped if the new content differs from the current.
   */
  reload: (opts?: { silent?: boolean }) => Promise<void>;
  /** Acknowledge the new-paths highlight so it fades on the next tick. */
  ackNewPaths: () => void;
  /** Acknowledge the content-changed highlight. */
  ackContentChanged: () => void;
}

/**
 * Manages file listing and content loading for a session's file explorer.
 *
 * @param getSessionId - reactive getter for the current session ID
 */
export function useSessionFiles(getSessionId: () => string | null | undefined): SessionFilesState {
  const files = ref<SessionFileEntry[]>([]);
  const filesLoading = ref(false);
  const filesError = ref<string | null>(null);

  const selectedPath = ref<string | null>(null);
  const selectedFileType = ref<SessionFileType | null>(null);
  const fileContent = ref<string | null>(null);
  const fileContentLoading = ref(false);
  const fileContentError = ref<string | null>(null);

  const dbData = ref<SessionDbTable[] | null>(null);
  const dbDataLoading = ref(false);
  const dbDataError = ref<string | null>(null);

  // New-file highlight bookkeeping: set of paths that appeared on the most
  // recent silent refresh. Cleared by the consumer after it has rendered the
  // highlight (see `ackNewPaths`). This stays empty after the initial load so
  // we don't flash every file green on first mount.
  const newFilePaths = ref<Set<string>>(new Set());
  const contentChangedAt = ref<number | null>(null);
  let knownPaths: Set<string> = new Set();
  // Track size-per-path so a size change (the common signal for "agent wrote
  // to this file") can flash the entry even when it isn't the selected file.
  // Imperfect vs mtime — a same-size rewrite won't flag — but catches the
  // dominant append/save case without requiring a Rust-side schema change.
  let knownSizes: Map<string, number> = new Map();
  let hasInitialLoad = false;

  // Monotonic counters used to discard results from superseded requests.
  // `readSeq` tracks user-initiated selectFile() calls (which own the loading
  // flags). `silentSeq` tracks background silentRefetchSelected() calls; kept
  // separate so a silent refetch started mid-selectFile() cannot preempt the
  // user call's sequence guard and leave loading flags stuck `true`.
  let readSeq = 0;
  let silentSeq = 0;
  let loadSeq = 0;

  async function loadFiles(opts: { silent?: boolean } = {}) {
    const sessionId = getSessionId();
    if (!sessionId) return;

    const silent = opts.silent ?? false;
    const seq = ++loadSeq;
    // Silent refresh keeps the existing list mounted so scroll/focus survive.
    if (!silent) filesLoading.value = true;
    filesError.value = null;

    try {
      const result = await sessionListFiles(sessionId);
      // Discard if session changed while we were awaiting
      if (seq !== loadSeq) return;

      // Detect newly-appeared paths and size-changed paths for the bonus
      // highlight. Skip on the very first load so every file isn't flagged.
      if (hasInitialLoad) {
        const nextNew = new Set<string>();
        for (const entry of result) {
          if (entry.isDirectory) continue;
          if (!knownPaths.has(entry.path)) {
            nextNew.add(entry.path);
          } else {
            const prevSize = knownSizes.get(entry.path);
            if (prevSize !== undefined && prevSize !== entry.sizeBytes) {
              nextNew.add(entry.path);
            }
          }
        }
        if (nextNew.size > 0) newFilePaths.value = nextNew;
      }
      knownPaths = new Set(result.filter((e) => !e.isDirectory).map((e) => e.path));
      knownSizes = new Map(result.filter((e) => !e.isDirectory).map((e) => [e.path, e.sizeBytes]));
      hasInitialLoad = true;

      files.value = result;

      // Auto-open workspace.yaml if nothing is selected yet
      if (!selectedPath.value) {
        const workspace = files.value.find(
          (f) => !f.isDirectory && (f.name === "workspace.yaml" || f.name === "workspace.yml"),
        );
        if (workspace) {
          await selectFile(workspace.path, workspace.fileType);
        }
      } else if (silent) {
        // Refetch the open file silently so agent-driven edits on disk show
        // up without the user having to re-click the file.
        const open = files.value.find((f) => f.path === selectedPath.value);
        if (open && !open.isDirectory) {
          void silentRefetchSelected(open.fileType);
        }
      }
    } catch (err) {
      if (seq !== loadSeq) return;
      filesError.value = err instanceof Error ? err.message : String(err);
      if (!silent) files.value = [];
    } finally {
      if (seq === loadSeq && !silent) filesLoading.value = false;
    }
  }

  /**
   * Re-read the currently-open file's content / SQLite tables in place.
   * Does NOT toggle loading flags and only mutates the ref when content
   * actually differs, so the viewer DOM stays stable and scroll is preserved.
   */
  async function silentRefetchSelected(fileType: SessionFileType) {
    const sessionId = getSessionId();
    const path = selectedPath.value;
    if (!sessionId || !path) return;
    if (fileType === "binary") return;

    const seq = ++silentSeq;
    try {
      if (fileType === "sqlite") {
        const result = await sessionReadSqlite(sessionId, path);
        if (seq !== silentSeq || selectedPath.value !== path) return;
        // Replace wholesale — SqliteViewer reacts to the prop change.
        dbData.value = result;
        dbDataError.value = null;
        return;
      }
      const result = await sessionReadFile(sessionId, path);
      if (seq !== silentSeq || selectedPath.value !== path) return;
      if (result !== fileContent.value) {
        fileContent.value = result;
        contentChangedAt.value = Date.now();
      }
      fileContentError.value = null;
    } catch (err) {
      if (seq !== silentSeq || selectedPath.value !== path) return;
      // Silent refresh failures should not clobber existing content — only
      // surface the error so the user sees a hint but keeps the stale view.
      if (fileType === "sqlite") {
        dbDataError.value = err instanceof Error ? err.message : String(err);
      } else {
        fileContentError.value = err instanceof Error ? err.message : String(err);
      }
    }
  }

  async function selectFile(path: string, fileType: SessionFileType) {
    const sessionId = getSessionId();
    if (!sessionId) return;

    selectedPath.value = path;
    selectedFileType.value = fileType;
    fileContent.value = null;
    fileContentError.value = null;
    fileContentLoading.value = false;
    dbData.value = null;
    dbDataError.value = null;

    if (fileType === "binary") {
      fileContentLoading.value = false;
      return;
    }

    if (fileType === "sqlite") {
      dbDataLoading.value = true;
      const seq = ++readSeq;
      try {
        const result = await sessionReadSqlite(sessionId, path);
        if (seq !== readSeq) return;
        dbData.value = result;
      } catch (err) {
        if (seq !== readSeq) return;
        dbDataError.value = err instanceof Error ? err.message : String(err);
        dbData.value = null;
      } finally {
        if (seq === readSeq) dbDataLoading.value = false;
      }
      return;
    }

    fileContentLoading.value = true;
    const seq = ++readSeq;

    try {
      const result = await sessionReadFile(sessionId, path);
      // Discard if a newer request has since been started
      if (seq !== readSeq) return;
      fileContent.value = result;
    } catch (err) {
      if (seq !== readSeq) return;
      fileContentError.value = err instanceof Error ? err.message : String(err);
      fileContent.value = null;
    } finally {
      if (seq === readSeq) {
        fileContentLoading.value = false;
      }
    }
  }

  // Reload when session changes
  watch(
    getSessionId,
    (id) => {
      files.value = [];
      filesError.value = null;
      selectedPath.value = null;
      selectedFileType.value = null;
      fileContent.value = null;
      fileContentError.value = null;
      dbData.value = null;
      dbDataError.value = null;
      knownPaths = new Set();
      knownSizes = new Map();
      newFilePaths.value = new Set();
      contentChangedAt.value = null;
      hasInitialLoad = false;
      if (id) void loadFiles();
    },
    { immediate: true },
  );

  function ackNewPaths() {
    if (newFilePaths.value.size > 0) newFilePaths.value = new Set();
  }

  function ackContentChanged() {
    contentChangedAt.value = null;
  }

  return {
    get files() {
      return files.value;
    },
    get filesLoading() {
      return filesLoading.value;
    },
    get filesError() {
      return filesError.value;
    },
    get selectedPath() {
      return selectedPath.value;
    },
    get selectedFileType() {
      return selectedFileType.value;
    },
    get fileContent() {
      return fileContent.value;
    },
    get fileContentLoading() {
      return fileContentLoading.value;
    },
    get fileContentError() {
      return fileContentError.value;
    },
    get dbData() {
      return dbData.value;
    },
    get dbDataLoading() {
      return dbDataLoading.value;
    },
    get dbDataError() {
      return dbDataError.value;
    },
    get newFilePaths() {
      return newFilePaths.value;
    },
    get contentChangedAt() {
      return contentChangedAt.value;
    },
    selectFile,
    reload: (opts) => loadFiles({ silent: true, ...(opts ?? {}) }),
    ackNewPaths,
    ackContentChanged,
  };
}
